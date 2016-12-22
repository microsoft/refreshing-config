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
      .then(emitPromise.promise)
      .done();
  });

  it('can get all the settings from the store', () => {
    const values = { foo: 'bar', hello: 'world' };
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar', hello: 'world' }))
    };
    const target = new config.RefreshingConfig(store);
    return target.getAll().then(value => {
      value._emitter.should.be.instanceof(events.EventEmitter);
      delete value._emitter;
      value.should.deep.equal(values);
    });
  });

  it('caches settings from store by default', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' }))
    };
    const target = new config.RefreshingConfig(store);
    return Q.all(target.get('foo'), target.get('bar'))
      .done(() => store.getAll.calledOnce.should.be.true);
  });

  it('refreshes if any refresh policy says yes', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' }))
    };
    const noRefreshPolcy = {
      shouldRefresh: sinon.stub().returns(false)
    };
    const yesRefreshPolicy = {
      shouldRefresh: sinon.stub().returns(true)
    };
    const target = new config.RefreshingConfig(store)
      .withExtension(noRefreshPolcy)
      .withExtension(yesRefreshPolicy);
    return Q.all(target.get('foo'), target.get('bar'))
      .done(() => {
        store.getAll.calledTwice.should.be.true;
        noRefreshPolcy.shouldRefresh.calledOnce.should.be.true;
        yesRefreshPolicy.shouldRefresh.calledOnce.should.be.true;
      });
  });

  it('doesn\'t refresh if all refresh policies say no', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' }))
    };
    const noRefreshPolcy = {
      shouldRefresh: sinon.stub().returns(false)
    };
    const target = new config.RefreshingConfig(store)
      .withExtension(noRefreshPolcy);
    return Q.all(target.get('foo'), target.get('bar'))
      .done(() => {
        store.getAll.calledOnce.should.be.true;
        noRefreshPolcy.shouldRefresh.calledOnce.should.be.true;
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
    const store = {
      getAll: sinon.stub()
        .returns(Q({ foo: 'bar' })).onFirstCall()
        .returns(Q({ foo: 'bar', hello: 'world' })).onSecondCall()
    };
    const refreshOnDemandPolicy = {
      subscribe: (subscriber) => { this.subscriber = subscriber; },
      refresh: () => this.subscriber.refresh()
    };
    // TODO: emit on target and config
    const target = new config.RefreshingConfig(store)
      .withExtension(refreshOnDemandPolicy);
    target.getAll()
      .then(() => {

      });
  });

  it('supports fluent addition of extensions', () => {
    const target = new config.RefreshingConfig({});
    target.withExtension(null).should.eq(target);
    target.withExtension({}).should.eq(target);
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
});