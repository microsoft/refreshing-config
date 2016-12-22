const Q = require('q');
const chai = require('chai');
const sinon = require('sinon');
chai.should();

const config = require('../index');

describe('index', () => {
  it('requires a store', () => {
    (() => {
      new config.DynamicConfig();
    }).should.throw(Error);
  });

  it('can retrieve a setting from the store', () => {
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar' }))
    };
    const target = new config.RefreshingConfig(store);
    return target.get('foo').then(value => value.should.equal('bar'));
  });

  it('can get all the settings from the store', () => {
    const values = { foo: 'bar', hello: 'world' };
    const store = {
      getAll: sinon.stub().returns(Q({ foo: 'bar', hello: 'world' }))
    };
    const target = new config.RefreshingConfig(store);
    return target.getAll().then(value => value.should.equal(values));
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
    const target = new config.RefreshingConfig(store)
      .withExtension(refreshOnDemandPolicy);
    target.getAll()
      .then(() => {

      });
  });
});