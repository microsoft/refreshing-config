/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

const debug = require('debug')('dynamic-config');
const EventEmitter = require('events');
const Q = require('q');
const patch = require('fast-json-patch');
const moment = require('moment');
const InMemoryConfigStore = require('./inmemoryStore').InMemoryConfigStore;
const InMemoryPubSubRefreshPolicyAndChangePublisher = require('./inmemoryStore').InMemoryPubSubRefreshPolicyAndChangePublisher;

// TODO: Support patching config
// TODO: Can we be fancier with data types?
// TODO: Review failure conditions with refreshPolicies and changePublishers

class RefreshingConfig extends EventEmitter {
  constructor(store) {
    super();
    if (!store) {
      debug('Missing store');
      throw new Error('Missing store');
    }
    this.store = store;
    this.refreshPolicies = [];
    this.changePublishers = [];
    this.config = {};
    this.config._emitter = this;
    this.firstTime = true;
  }

  get(name) {
    if (!name) {
      throw new Error('Missing name');
    }
    return this.refreshIfNeeded().then(() => {
      return this.config[name];
    });
  }

  getAll() {
    return this.refreshIfNeeded().then(() => {
      return this.config;
    });
  }

  set(name, value) {
    const self = this;
    return this.store.set(name, value)
      .then(() => {
        this.emit('set', name, value);
        this.changePublishers.forEach(publisher => {
          try {
            publisher.publish('set', name, value);
          }
          catch (e) {
            // Empty block
          }
        });
      })
      .then(this.refresh.bind(self));
  }

  delete(name) {
    const self = this;
    return this.store.delete(name)
      .then(() => {
        this.emit('delete', name);
        this.changePublishers.forEach(publisher => {
          try {
            publisher.publish('delete', name);
          }
          catch (e) {
            // Empty block
          }
        });
      })
      .then(this.refresh.bind(self));
  }

  apply(patches) {
    // Snapshot the properties/name and apply the patches. If a changed property is still present,
    // it was changed so set. If it is now missing, delete it.
    const newConfig = Object.assign({}, this.config);
    patch.apply(newConfig, patches);
    const affected = this._getAffectedProperties(patches);
    return Q.all(affected.map(key => {
      if (newConfig[key] === undefined) {
        return this.delete(key);
      } else {
        return this.set(key, newConfig[key]);
      }
    }));
  }

  _getAffectedProperties(patches) {
    return Array.from(patches.reduce((result, patch) => {
      result.add(patch.path.split('/')[1]);
      return result;
    }, new Set()));
  }

  withExtension(extension) {
    if (!extension) {
      return this;
    }
    if (typeof (extension['subscribe']) === 'function') {
      extension.subscribe(this);
    }
    if (typeof (extension['shouldRefresh']) === 'function') {
      this.refreshPolicies.push(extension);
    }
    if (typeof (extension['publish']) === 'function') {
      this.changePublishers.push(extension);
    }
    return this;
  }

  refresh() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    const self = this;
    this.refreshPromise = this.store.getAll()
      .then(newConfig => {
        self.refreshPromise = null;
        const configPatch = patch.compare(self.config, newConfig);
        const emitterPatchIndex = configPatch.findIndex(patch => patch.path === '/_emitter');
        /* istanbul ignore else */
        if (emitterPatchIndex >= 0) {
          configPatch.splice(emitterPatchIndex, 1);
        }
        if (configPatch.length !== 0) {
          patch.apply(self.config, configPatch);
          self.emit('changed', self.config, configPatch);
        }
        self.emit('refresh', self.config);
        return self.config;
      });
    return this.refreshPromise;
  }

  refreshIfNeeded() {
    let shouldRefresh = this.firstTime;
    this.firstTime = false;
    if (!shouldRefresh) {
      for (let i = 0; i < this.refreshPolicies.length; i++) {
        const refreshPolicy = this.refreshPolicies[i];
        if (refreshPolicy.shouldRefresh()) {
          shouldRefresh = true;
          break;
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
    if (typeof duration !== 'number' || duration <= 0) {
      throw new Error('Invalid duration');
    }
    this.duration = duration;
  }

  shouldRefresh() {
    if (!this.lastRefresh || moment() > this.lastRefresh.add(this.duration, 'ms')) {
      this.lastRefresh = moment();
      return true;
    }
    return false;
  }
}

// Refresh periodically
class IntervalRefreshPolicy {
  constructor(duration) {
    if (typeof duration !== 'number' || duration <= 0) {
      throw new Error('Invalid duration');
    }
    this.duration = duration;
  }

  subscribe(subscriber) {
    if (this.subscriber) {
      throw new Error('Already subscribed');
    }
    this.subscriber = subscriber;
    this.interval = setInterval(() => {
      try {
        subscriber.refresh();
      }
      catch (e) {
        // Empty block
      }
    }, this.duration);
  }

  unsubscribe() {
    if (this.interval) {
      clearInterval(this.interval);
      this.subscriber = null;
    }
  }
}

module.exports = {
  RefreshingConfig: RefreshingConfig,
  RefreshPolicy: {
    AlwaysRefreshPolicy: AlwaysRefreshPolicy,
    NeverRefreshPolicy: NeverRefreshPolicy,
    StaleRefreshPolicy: StaleRefreshPolicy,
    IntervalRefreshPolicy: IntervalRefreshPolicy
  },
  InMemoryConfigStore: InMemoryConfigStore,
  InMemoryPubSubRefreshPolicyAndChangePublisher: InMemoryPubSubRefreshPolicyAndChangePublisher
};