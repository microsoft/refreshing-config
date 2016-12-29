const clone = require('clone');
const events = require('events');
const Q = require('q');
const chai = require('chai');
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
    (() => target.get(null)).should.throw(Error);
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
    // chain the gets here as concurrent gets will get coalesced
    return target.get('foo').then(() => target.get('bar'))
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
      refresh: () => this.subscriber.refresh()
    };
    new config.RefreshingConfig(store)
      .withExtension(refreshOnDemandPolicy);
    refreshOnDemandPolicy.refresh();
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
  });
});

describe('AlwaysRefreshPolicy', () => {
  it('always returns true', () => {
    const target = new config.RefreshPolicy.AlwaysRefreshPolicy();
    target.shouldRefresh().should.true;
  });
});

describe('NeverRefreshPolicy', () => {
  it('always returns false', () => {
    const target = new config.RefreshPolicy.NeverRefreshPolicy();
    target.shouldRefresh().should.be.false;
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
    target.shouldRefresh();
    clock.tick(5000);
    target.shouldRefresh().should.be.true;
  });
  it('doesn\'t refresh if the interval hasnn\'t passed', () => {
    const target = new config.RefreshPolicy.StaleRefreshPolicy(5000);
    target.shouldRefresh();
    clock.tick(1000);
    target.shouldRefresh().should.be.false;
  });
  it('throws if duration is not a number', () => {
    (() => new config.RefreshPolicy.StaleRefreshPolicy(null)).should.throw(Error);
  });
  it('throws if duration is less than 1', () => {
    (() => new config.RefreshPolicy.StaleRefreshPolicy(0)).should.throw(Error);
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