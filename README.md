![Version](https://img.shields.io/npm/v/refreshing-config.svg)
![License](https://img.shields.io/github/license/Microsoft/refreshing-config.svg)
![Downloads](https://img.shields.io/npm/dt/refreshing-config.svg)

# refreshing-config
Configuration library that can dynamically refresh configuration values.

# Usage

# Stores
refreshing-config requires a store that will store the configuration values. We provide a Redis-backed store in https://npmjs.org/package/refreshing-config-redis but you can implement your own store for
your configuration backend.

### Writing a store
Stores must implement ```getAll(): IPromise<object>``` and can optionally implement ```set(name: string, value: any): IPromise<any>``` and ```delete(name: string): IPromise<void>```. The ```getAll()```
function should return an object whose keys are the names of the configuration values and the value is the configuration value itself. Stores should support the full set of JavaScript data types.

# Events
The following events are emitted from ```RefreshingConfig```:
* ```set(name, value)```: Emitted when a configuration value has been set in the underlying store where ```name```
is the name of the configuration value and ```value``` is the new value.
* ```delete(name)```: Emitted when a configuration value has been deleted where ```name``` is the name
of the configuration value that was deleted.
* ```changed(config, patch)```: Emitted when a change is detected in the configuration values after a refresh where
```config``` is the updated configuration (including unchanged values) and ```patch``` is a JSON patch describing
the changes that were detected.
* ```refresh(config)```: Emitted whenever the configuration is refreshed from the store where ```config```
is the configuration after the refresh.

The object returned from ```getAll()``` also has an event emitter in the ```_emitter``` property. This
event emitter will emit the same ```changed(config, patch)``` event as ```RefreshingConfig```. This can
be useful if you want to pass the configuration object around you application and allow different parts
of your application to subscribe to updates to the configuration.

# Extensions
You can extend refreshing-config's behavior by attaching extensions using ```withExtension```:

```javascript
const config = new RefreshingConfig.RefreshingConfig(store)
  .withExtension(myExtension1)
  .withExtension(myExtension2);
```

## Refresh policies
Refresh policies define when refreshing-config should go back to the store to get updated configuration values. Refresh policies can either be reactive (refreshing-config asks them if it should go back to the store) 
or proactive (they notify refreshing-config that it needs to refresh). If there are multiple refresh policies attached then refreshing-config will go back to the store if **any** of them say a refresh is required.

Refresh policies are bypassed in the following scenarios:

* The read of the first configuration value (to get the initial set of configuration values)
* After a set or delete (because we know the configuration values are stale)

### NeverRefreshPolicy (reactive)
This is the default policy and will only go to the store when the first setting is read or when we know the values have changed (for example, if ```set``` or ```delete``` is called).

```javascript
const config = new RefreshingConfig.RefreshingConfig(store)
  .withExtension(new RefreshingConfig.RefreshPolicy.NeverRefreshPolicy());
```

### AlwaysRefreshPolicy (reactive)
This policy will go back to the store everytime a configuration value is read.

```javascript
const config = new RefreshingConfig.RefreshingConfig(store)
  .withExtension(new RefreshingConfig.RefreshPolicy.AlwaysRefreshPolicy());
```

### StaleRefreshPolicy (reactive)
This policy will go back to the store if it hasn't been back to the store for the specified number of milliseconds. In this example the store will be accessed at most every 30 seconds:

```javascript
const config = new RefreshingConfig.RefreshingConfig(store)
  .withExtension(new RefreshingConfig.RefreshPolicy.StaleRefreshPolicy(30000));
```

### IntervalRefreshPolicy (proactive)
This policy will proactively refresh the configuration values from the store at the defined interval. In this example the configuration values will be refreshed every 30 seconds.

```javascript
const config = new RefreshingConfig.RefreshingConfig(store)
  .withExtension(new RefreshingConfig.RefreshPolicy.IntervalRefreshPolicy(30000));
```

### Writing a refresh policy
A refresh policy must implement either ```shouldRefresh(): boolean``` (for reactive refresh policies) or ```subscribe(subscriber: RefreshingConfig)``` (for proactive refresh policies). Proactive refresh
policies should call ```subscriber.refresh()``` whenever they want the configuration values refreshed from the store.

## Change notifiers
Change notifiers are notified when refreshing-config has modified a configuration value (for example, when ```set``` or ```delete``` is called). This can be used to notify others about the need to refresh config.
Note that these are not called when configuration values are changed externally in the store, if you want to know about those you should subscribe to the ```changed``` event on ```RefreshingConfig```.

Change notifiers are generally paired with a refresh policy, in this pattern the change notifier is told about the change and communicates it to interested consumers, these consumers consume the notification
in their refresh policy which then tells the configuration library to retrieve the new values from the store.

There are no out of the box change notifiers but see https://github.com/Microsoft/refreshing-config-redis to see an example refresh policy/change notifier that use Redis pub/sub to refresh configuration
values automatically when they change.

### Writing a change notifier
A change notifier must implement the ```publish(operation: string, name: string, value: string)``` method which will be called whenever a ```set``` or ```delete``` is performed. The operation will either
be ```set``` or ```delete```, the ```name``` will be the name of the configuration value impacted, and the ```value``` will be the new value (for ```set``` operations).

# Contributing
Pull requests will gladly be considered!

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see 
the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) 
with any additional questions or comments.