/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

const debug = require('debug')('dynamic-config');
const EventEmitter = require('events');
const Q = require('q');
const patch = require('fast-json-patch');
const uuid = require('uuid');

// TODO: Support patching config
// TODO: Can we be fancier with data types?
// TODO: Review failure conditions with refreshPolicies and changePublishers

class DynamicConfig extends EventEmitter {
  constructor(store) {
    super();
    if (!store) {
      debug('Missing store');
      throw new Error('Missing store');
    }
    this.store = store;
    this.refreshPolicies = this.changePublishers = [];
    this.config = {};
    this.config._emitter = new EventEmitter();
    this.firstTime = true;
  }

  get(name) {
    if (!name) {
      throw new Error('Missing name');
    }
    return this.refreshIfNeeded().then(() => {
      return this.config[name];
    })
  }

  getAll() {
    return this.refreshIfNeeded().then(() => {
      return this.config;
    })
  }

  set(name, value) {
    const self = this;
    return this.store.set(name, value)
      .then(() => {
        this.emit('set', name, value);
        this.changePublishers.forEach(publisher => {
          try {
            publisher.publish();
          }
          catch (e) {
          }
        })
      })
      .then(this.refresh.bind(self));
  }

  withExtension(extension) {
    if (!extension) {
      return this;
    }
    if (typeof (extension['subscribe']) === 'function' || typeof (extension['shouldRefresh']) === 'function') {
      if (typeof (extension['subscribe']) === 'function') {
        extension.subscribe(this);
      }
      this.refreshPolicies.push(extension);
    }
    if (typeof (extension['publish']) !== 'function') {
      this.changePublishers.push(extension);
    }
    return this;
  }

  refresh() {
    const self = this;
    return this.store.getAll()
      .then(newConfig => {
        const configPatch = patch.compare(self.config, newConfig);
        for (let i = 0; i < configPatch.length; i++) {
          const value = configPatch[i];
          if (value.op === 'remove' && value.path === '/_emitter') {
            configPatch.splice(i, 1);
            break;
          }
        }
        if (configPatch.length !== 0) {
          patch.apply(self.config, configPatch);
          self.emit('changed', self.config, configPatch);
          self.config._emitter.emit('changed', self.config, configPatch);
        }
        self.emit('refresh', self.config);
        return self.config;
      });
  }

  refreshIfNeeded() {
    let shouldRefresh = this.firstTime;
    this.firstTime = false;
    if (!shouldRefresh) {
      for (let i = 0; i < this.refreshPolicies.length; i++) {
        const refreshPolicy = this.refreshPolicies[i];
        if (typeof (refreshPolicy['shouldRefresh']) === 'function') {
          if (refreshPolicy.shouldRefresh()) {
            shouldRefresh = true;
            break;
          }
        }
      }
    }
    if (shouldRefresh) {
      return this.refresh();
    }
    return Q(this.config);
  }
}

// Refresh on every get/set
class AlwaysRefreshPolicy {
  shouldRefresh() {
    return true;
  }
}

// Never refresh automatically
class NeverRefreshPolicy {
  shouldRefresh() {
    return false;
  }
}

// Refresh if we haven't refreshed recently
class StaleRefreshPolicy {
  constructor(duration) {
    // TODO Validate
    this.duration = duration;
  }

  shouldRefresh() {
    if (!this.lastRefresh || moment.now() > this.lastRefresh.add(this.duration)) {
      this.lastRefresh = moment.now();
      return true;
    }
    return false;
  }
}

// Refresh periodically
class IntervalRefreshPolicy {
  constructor(duration) {
    this.duration = duration;
  }

  subscribe(subscriber) {
    if (this.subscriber) {
      throw new Error('Already subscribed');
    }
    this.interval = setInterval(() => {
      try {
        subscriber.refresh();
      }
      catch (e) {
      }
    }, 1000);
  }

  unsubscribe() {
    if (this.interval) {
      clearInterval(this.interval);
      this.subscriber = null;
    }
  }
}

// Refresh when a change is detected
class RedisPubSubRefreshPolicyAndChangePublisher {
  constructor(redisClient, channel) {
    if (!redisClient) {
      throw new Error('Missing redisClient');
    }
    if (!channel) {
      throw new Error('Missing channel');
    }
    this.redisClient = redisClient;
    this.channel = channel;
    this.publisherId = uuid();

    const subscriberClient = redisClient.duplicate();
    subscriberClient.on('message', this.refreshSubscriber.bind(this))
    subscriberClient.subscribe(channel);
  }

  subscribe(subscriber) {
    if (this.subscriber) {
      throw new Error('Already subscribed');
    }
    this.subscriber = subscriber;
  }

  publish() {
    this.redisClient.publish(this.channel, this.publisherId);
  }

  refreshSubscriber(publisherId) {
    if (this.subscriber && this.publisherId !== publisherId) {
      try {
        this.subscriber.refresh();
      }
      catch (e) {
      }
    }
  }
}

class RedisConfigStore {
  constructor(redisClient, key) {
    if (!redisClient) {
      throw new Error('Missing redisClient');
    }
    if (!key) {
      throw new Error('Missing key');
    }
    this.redisClient = redisClient;
    this.key = key;
  }

  getAll() {
    const deferred = Q.defer();
    this.redisClient.hgetall(this.key, (error, reply) => {
      if (error) {
        return deferred.reject(error);
      }
      return deferred.resolve(reply);
    });
    return deferred.promise;
  }

  set(name, value) {
    const deferred = Q.defer();
    this.redisClient.hset(this.key, name, value, (error, reply) => {
      if (error) {
        return deferred.reject(error);
      }
      return deferred.resolve(value);
    });
    return deferred.promise;
  }

  toExtension(channel) {
    if (!channel) {
      throw new Error('Missing channel');
    }
    return new RedisPubSubRefreshPolicyAndChangePublisher(this.redisClient.duplicate(), channel);
  }
}

module.exports = {
  DynamicConfig: DynamicConfig,
  Store: {
    RedisConfigStore: RedisConfigStore,
  },
  RefreshPolicy: {
    AlwaysRefreshPolicy: AlwaysRefreshPolicy,
    NeverRefreshPolicy: NeverRefreshPolicy,
    StaleRefreshPolicy: StaleRefreshPolicy,
    IntervalRefreshPolicy: IntervalRefreshPolicy,
    RedisPubSubRefreshPolicyAndChangePublisher: RedisPubSubRefreshPolicyAndChangePublisher
  }
}