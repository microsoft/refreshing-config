const Q = require('q');

// Refresh when a change is detected
class InMemoryPubSubRefreshPolicyAndChangePublisher {
  constructor() {
  }

  subscribe(subscriber) {
    if (this.subscriber) {
      throw new Error('Already subscribed');
    }
    this.subscriber = subscriber;
  }

  publish() {
    this.refreshSubscriber();
  }

  refreshSubscriber() {
    if (this.subscriber) {
      try {
        this.subscriber.refresh();
      }
      catch (e) {
        // Empty block
      }
    }
  }
}

class InMemoryConfigStore {
  constructor(store = null) {
    this.store = store || {};
  }

  getAll() {
    return Q(this.store);
  }

  delete(name) {
    delete this.store[name];
    return Q();
  }

  set(name, value) {
    this.store[name] = value;
    return Q();
  }

  toExtension() {
    return new InMemoryPubSubRefreshPolicyAndChangePublisher();
  }
}

module.exports = {
  InMemoryConfigStore: InMemoryConfigStore,
  InMemoryPubSubRefreshPolicyAndChangePublisher: InMemoryPubSubRefreshPolicyAndChangePublisher
};