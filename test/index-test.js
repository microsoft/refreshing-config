// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const chai = require('chai');
const clone = require('clone');
const events = require('events');
const Q = require('q');
const sinon = require('sinon');
chai.should();

const config = require('../index');

var clock;

describe('RefreshingConfig', () => {
  it('requires a store', () => {
    (() => {
      new config.RefreshingConfig();
    }).should.throw(Error);
  });
  it('can retrieve a setting from the store', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' }))
    };
    const target = new config.RefreshingConfig(store);
    return target.get('foo').then(value => value.should.equal('bar'));
  });
  it('fails to retrieve a setting if there is no name', () => {
    const target = new config.RefreshingConfig({});
    (() => target.get(null)).should.throw(Error, /Missing name/);
  });
  it('can set a setting in the store', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' })),
      set: sinon.stub().returns(Q())
    };
    const publisher = {
      subscribe: (subscriber) => this.subscriber = subscriber,
      publish: sinon.stub()
    };
    const target = new config.RefreshingConfig(store)
      .withExtension(publisher);
    target.changePublishers.length.should.equal(1);
    const emitPromise = Q.defer();
    target.on('set', (name, value) => {
      name.should.equal('foo');
      value.should.equal('bar');
      emitPromise.resolve();
    });
    return target.set('foo', 'bar').then(() => {
      store.set.calledOnce.should.be.true;
      store.set.calledWith('foo', 'bar').should.be.true;
      store.getAll.calledOnce.should.be.true;
      publisher.publish.calledOnce.should.be.true;
    }).then(emitPromise.promise);
  });
  it('can delete a setting from the store', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' })),
      delete: sinon.stub().returns(Q())
    };
    const publisher = {
      subscribe: (subscriber) => this.subscriber = subscriber,
      publish: sinon.stub()
    };
    const target = new config.RefreshingConfig(store)
      .withExtension(publisher);
    const emitPromise = Q.defer();
    target.on('delete', (name) => {
      name.should.equal('hello');
      emitPromise.resolve();
    });
    return target.delete('hello')
      .then(() => {
        store.delete.calledOnce.should.be.true;
        store.delete.calledWith('hello').should.be.true;
        store.getAll.calledOnce.should.be.true;
        publisher.publish.calledOnce.should.be.true;
      })
      .then(emitPromise.promise);
  });
  it('can get all the settings from the store', () => {
    const values = { foo: 'bar', hello: 'world' };
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar', hello: 'world' }))
    };
    const target = new config.RefreshingConfig(store);
    return target.getAll().then(value => {
      value._config.should.be.instanceof(events.EventEmitter);
      delete value._config;
      value.should.deep.equal(values);
    });
  });
  it('caches settings from store by default', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' }))
    };
    const target = new config.RefreshingConfig(store);
    return Q.all([target.get('foo'), target.get('bar')])
      .then(() => store.getAll.calledOnce.should.be.true);
  });
  it('refreshes if any refresh policy says yes', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' }))
    };
    const noRefreshPolicy = {
      shouldRefresh: sinon.stub().returns(false)
    };
    const yesRefreshPolicy = {
      shouldRefresh: sinon.stub().returns(true)
    };
    const target = new config.RefreshingConfig(store)
      .withExtension(yesRefreshPolicy)
      .withExtension(noRefreshPolicy);
    target.refreshPolicies.length.should.equal(2);
    // chain the gets here as concurrent gets will get coalesced
    return target.get('foo')
      .then(() => target.get('bar'))
      .then(() => {
        store.getAll.calledTwice.should.be.true;
        yesRefreshPolicy.shouldRefresh.should.be.calledOnce;
        noRefreshPolicy.shouldRefresh.callCount.should.equal(0);
      });
  });
  it('doesn\'t refresh if all refresh policies say no', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' }))
    };
    const noRefreshPolicy = {
      shouldRefresh: sinon.stub().returns(false)
    };
    const target = new config.RefreshingConfig(store)
      .withExtension(noRefreshPolicy);
    return Q.all([target.get('foo'), target.get('bar')])
      .then(() => {
        store.getAll.calledOnce.should.be.true;
        noRefreshPolicy.shouldRefresh.calledOnce.should.be.true;
      });
  });
  it('refreshes if refresh policy proactively asks', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' }))
    };
    const refreshOnDemandPolicy = {
      subscribe: (subscriber) => { this.subscriber = subscriber; },
      refresh: () => { this.subscriber.refresh(); }
    };
    const subscribeSpy = sinon.spy(refreshOnDemandPolicy, 'subscribe');
    const refreshSpy = sinon.spy(refreshOnDemandPolicy, 'refresh');

    new config.RefreshingConfig(store)
      .withExtension(refreshOnDemandPolicy);  
    subscribeSpy.calledOnce.should.be.true;

    refreshOnDemandPolicy.refresh();
    refreshSpy.calledOnce.should.be.true;
    store.getAll.calledOnce.should.be.true;
  });
  it('notifies subscribers of changes', () => {
    const firstResponse = { foo: 'bar' };
    const secondResponse = { foo: 'bar', hello: 'world', _a: 'b' };
    const getAllStub = sinon.stub();
    getAllStub.onFirstCall().returns(Q(firstResponse));
    getAllStub.onSecondCall().returns(Q(secondResponse));

    const store = {
      getAll: getAllStub
    };

    // TODO: emit on target and config
    const targetEmitDeferand = Q.defer();
    const valuesEmitDeferand = Q.defer();

    const target = new config.RefreshingConfig(store)
      .withExtension(new config.RefreshPolicy.AlwaysRefreshPolicy());

    let invokeCount = 0;
    target.on('changed', (newValues, diff) => {
      invokeCount += 1;
      newValues = clone(newValues);
      delete newValues._config;
      if (invokeCount === 1) {
        newValues.should.deep.equal(firstResponse);
        diff.length.should.equal(1);
      }
      if (invokeCount === 2) {
        newValues.should.deep.equal(secondResponse);
        diff.length.should.equal(2);
      }
      targetEmitDeferand.resolve();
    });
    const getAllPromise = target.getAll()
      .then(values => {
        values._config.on('changed', (newValues, diff) => {
          newValues = clone(newValues);
          delete newValues._config;
          newValues.should.deep.equal(secondResponse);
          diff.length.should.equal(2);
          valuesEmitDeferand.resolve();
        });
        values = clone(values);
        delete values._config;
        values.should.deep.equal(firstResponse);
      })
      .then(target.getAll.bind(target))
      .then(values => {
        values = clone(values);
        delete values._config;
        values.should.deep.equal(secondResponse);
      });

    return Q.all([getAllPromise, targetEmitDeferand.promise, valuesEmitDeferand.promise]);
  });
  it('supports fluent addition of extensions', () => {
    const target = new config.RefreshingConfig({});
    target.withExtension(null).should.equal(target);
    target.withExtension({}).should.equal(target);
    target.refreshPolicies.length.should.equal(0);
    target.changePublishers.length.should.equal(0);
  });
  it('applies patches correctly', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar', test: 42 })),
      set: sinon.stub().returns(Q()),
      delete: sinon.stub().returns(Q())
    };
    const target = new config.RefreshingConfig(store);
    const patches = [
      { op: 'add', path: '/first', value: 'value' },
      { op: 'replace', path: '/foo', value: 'fred' },
      { op: 'remove', path: '/test' },
      { op: 'remove', path: '/test2' }
    ];
    return target.apply(patches).then(() => {
      store.set.calledTwice.should.be.true;
      store.set.firstCall.calledWith('first', 'value').should.be.true;
      store.set.secondCall.calledWith('foo', 'fred').should.be.true;
      store.delete.calledOnce.should.be.true;
      store.delete.firstCall.calledWith('test').should.be.true;
    });
  });
  it('refresh correctly', () => {
    const store = {
      getAll: sinon.stub().returns(Q({})),
    };
    const refreshOnDemandPolicy = {
      subscribe: (subscriber) => { this.subscriber = subscriber; },
      refresh: () => { this.subscriber.refresh(); }
    };
    new config.RefreshingConfig(store)
      .withExtension(refreshOnDemandPolicy);
    refreshOnDemandPolicy.refresh();
    store.getAll.calledOnce.should.be.true;
    refreshOnDemandPolicy.refresh();
    store.getAll.calledOnce.should.be.true;
  });
});

describe('AlwaysRefreshPolicy', () => {
  it('always returns true', () => {
    const target = new config.RefreshPolicy.AlwaysRefreshPolicy();
    target.shouldRefresh().should.true;
  });

  it('should always refresh', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' })),
    };
    const policy = new config.RefreshPolicy.AlwaysRefreshPolicy();
    const target = new config.RefreshingConfig(store)
      .withExtension(policy);
    const refreshSpy = sinon.spy(target, 'refresh');
    target.refreshIfNeeded();
    refreshSpy.calledOnce.should.be.true;
    target.refreshIfNeeded();
    refreshSpy.calledTwice.should.be.true;
  });
});

describe('NeverRefreshPolicy', () => {
  it('always returns false', () => {
    const target = new config.RefreshPolicy.NeverRefreshPolicy();
    target.shouldRefresh().should.be.false;
  });

  it('should only refresh the first time', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' })),
    };
    const policy = new config.RefreshPolicy.NeverRefreshPolicy();
    const target = new config.RefreshingConfig(store)
      .withExtension(policy);
    const refreshSpy = sinon.spy(target, 'refresh');
    target.refreshIfNeeded();
    refreshSpy.calledOnce.should.be.true;
    target.refreshIfNeeded();
    refreshSpy.calledOnce.should.be.true;
  });
});

describe('StaleRefreshPolicy', () => {
  beforeEach(function () {
    clock = sinon.useFakeTimers();
  });
  afterEach(function () {
    clock.restore();
  });
  it('refreshes on first call', () => {
    const target = new config.RefreshPolicy.StaleRefreshPolicy(1000);
    target.shouldRefresh().should.be.true;
  });
  it('refreshes if the interval has passed', () => {
    const target = new config.RefreshPolicy.StaleRefreshPolicy(1000);
    target.shouldRefresh().should.be.true;
    clock.tick(5000);
    target.shouldRefresh().should.be.true;
  });
  it('doesn\'t refresh if the interval hasnn\'t passed', () => {
    const target = new config.RefreshPolicy.StaleRefreshPolicy(5000);
    target.shouldRefresh().should.be.true;
    clock.tick(1000);
    target.shouldRefresh().should.be.false;
    clock.tick(1000);
    target.shouldRefresh().should.be.false;
  });
  it('refresh only when its time to', () => {
    const target = new config.RefreshPolicy.StaleRefreshPolicy(5000);
    target.shouldRefresh().should.be.true;
    clock.tick(1000);
    target.shouldRefresh().should.be.false;
    clock.tick(5000);
    target.shouldRefresh().should.be.true;
    clock.tick(5000);
    target.shouldRefresh().should.be.false;
  });
  it('throws if duration is not a number', () => {
    (() => new config.RefreshPolicy.StaleRefreshPolicy(null)).should.throw(Error, /Invalid duration/);
  });
  it('throws if duration is less than 1', () => {
    (() => new config.RefreshPolicy.StaleRefreshPolicy(0)).should.throw(Error, /Invalid duration/);
  });
});

describe('IntervalRefreshPolicy', () => {
  beforeEach(function () {
    clock = sinon.useFakeTimers();
  });
  afterEach(function () {
    clock.restore();
  });
  it('refreshes once the interval has passed', () => {
    const refreshingConfig = new config.RefreshingConfig({});
    refreshingConfig.refresh = sinon.stub();
    const refreshPolicy = new config.RefreshPolicy.IntervalRefreshPolicy(1000);
    refreshPolicy.subscribe(refreshingConfig);
    clock.tick(1250);
    refreshingConfig.refresh.calledOnce.should.be.true;
    clock.tick(1250);
    refreshingConfig.refresh.calledTwice.should.be.true;
    refreshPolicy.unsubscribe();
  });
  it('stops refreshing once unsubscribed', () => {
    const refreshingConfig = new config.RefreshingConfig({});
    refreshingConfig.refresh = sinon.stub();
    const refreshPolicy = new config.RefreshPolicy.IntervalRefreshPolicy(1000);
    refreshPolicy.subscribe(refreshingConfig);
    clock.tick(1250);
    refreshPolicy.unsubscribe();
    clock.tick(1250);
    refreshingConfig.refresh.calledOnce.should.be.true;
  });
  it('don\'t refresh if it\'s not time yet', () => {
    const refreshingConfig = new config.RefreshingConfig({});
    refreshingConfig.refresh = sinon.stub();
    const refreshPolicy = new config.RefreshPolicy.IntervalRefreshPolicy(1000);
    refreshPolicy.subscribe(refreshingConfig);
    clock.tick(1250);
    refreshingConfig.refresh.calledOnce.should.be.true;
    clock.tick(200);
    refreshingConfig.refresh.calledOnce.should.be.true;
    refreshPolicy.unsubscribe();
  });
  it('throws if duration is not a number', () => {
    (() => new config.RefreshPolicy.IntervalRefreshPolicy(null)).should.throw(Error, /invalid duration/i);
  });
  it('throws if duration is less than 1', () => {
    (() => new config.RefreshPolicy.IntervalRefreshPolicy(0)).should.throw(Error, /invalid duration/i);
  });
  it('throws if already subscribed', () => {
    (() => {
      const target = new config.RefreshPolicy.IntervalRefreshPolicy(1000);
      target.subscribe({});
      target.subscribe({});
    }).should.throw(Error, /already subscribed/i);
  });
  it('does not throw if you unsubscribe when not subscribed', () => {
    const target = new config.RefreshPolicy.IntervalRefreshPolicy(1000);
    target.unsubscribe();
  });
});

describe('InMemoryConfigStore', () => {
  it('initialize empty store', () => {
    const target = new config.InMemoryConfigStore();
    return target.getAll()
      .then((result) => {
        result.should.deep.equal({});
      });
  });
  it('initialize not empty store', () => {
    const store = { foo: 'bar' };
    const target = new config.InMemoryConfigStore(store);
    return target.getAll()
      .then((result) => {
        result.should.deep.equal(store);
      });
  });
  it('deletes value', () => {
    const store = { foo: 'bar', test: 42 };
    const afterDeleteStore = { foo: 'bar' };
    const target = new config.InMemoryConfigStore(store);
    return target.delete('test')
      .then(() => {
        return target.getAll();
      })
      .then((result) => {
        result.should.deep.equal(afterDeleteStore);
      });
  });
  it('sets a value', () => {
    const store = { foo: 'bar' };
    const afterSetStore = { foo: 'bar', test: 42 };
    const target = new config.InMemoryConfigStore(store);
    return target.set('test', 42)
      .then(() => {
        return target.getAll();
      })
      .then((result) => {
        result.should.deep.equal(afterSetStore);
      });
  });
  it('returns extension', () => {
    const target = new config.InMemoryConfigStore();
    const extension = target.toExtension();
    (extension instanceof config.InMemoryPubSubRefreshPolicyAndChangePublisher).should.be.true;
  });
});

describe('InMemoryPubSubRefreshPolicyAndChangePublisher', () => {
  it('don\'t throws error when publish without subscriber', () => {
    const publisher = new config.InMemoryPubSubRefreshPolicyAndChangePublisher();
    (() => {
      publisher.publish();
    }).should.not.throw(Error);
  });
  it('initialize using InMemoryConfigStore', () => {
    const store = new config.InMemoryConfigStore({ foo: 'bar' });
    const publisher = new config.InMemoryPubSubRefreshPolicyAndChangePublisher();
    const target = new config.RefreshingConfig(store)
      .withExtension(publisher);
    return target.getAll()
      .then((result) => {
        delete result._config;
        result.should.deep.equal({ foo: 'bar' });
      });
  });
  it('throws if already subscribed', () => {
    const store = new config.InMemoryConfigStore({ foo: 'bar' });
    const publisher = new config.InMemoryPubSubRefreshPolicyAndChangePublisher();
    new config.RefreshingConfig(store)
      .withExtension(publisher);
    (() => {
      publisher.subscribe({});
    }).should.throw(Error, /Already subscribed/);
  });
  it('refresh subscriber', () => {
    const store = new config.InMemoryConfigStore({ foo: 'bar' });
    const publisher = new config.InMemoryPubSubRefreshPolicyAndChangePublisher();
    const target = new config.RefreshingConfig(store)
      .withExtension(publisher);
    const refreshSpy = sinon.spy(target, 'refresh');
    publisher.publish();
    refreshSpy.calledOnce.should.be.true;
  });
});