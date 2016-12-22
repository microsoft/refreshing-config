/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

const debug = require('debug')('dynamic-config');
const EventEmitter = require('events');
const Q = require('q');
const patch = require('fast-json-patch');
const moment = require('moment');

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
            publisher.publish();
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
            publisher.publish();
          }
          catch (e) {
            // Empty block
          }
        });
      })
      .then(this.refresh.bind(self));
  }

  patch(patches) {
    if (!patches || patches.length === 0) {
      return this.config;
    }

    // TODO: Removes of whole keys?    
    const collectedPatches = this._collectPatches(patches);
    Object.getOwnPropertyNames(collectedPatches).forEach(name => {
      const target = this.config[name] || {};
      patch.apply(target, collectedPatches[name]);
    });
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


  _collectPatches(patches) {
    return patches.reduce((result, patch) => {
      const segments = patch.path.split('/');
      const key = segments[1];
      result[key] = result[key] || [];
      patch.path = '/' + segments.slice(2).join('/');
      result[key].push(patch);
      return result;
    }, {});
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
    if (!duration || duration <= 0) {
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
  }
};