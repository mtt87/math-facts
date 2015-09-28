'use strict';

var _ = require('underscore');
var assign = require('object-assign');
var EventEmitter = require('events').EventEmitter;
var Firebase = require('firebase');
var React = require('react-native');
var UuidGenerator = require('uuid');

var AsyncStorage = React.AsyncStorage;

var AppDispatcher = require('../dispatcher/AppDispatcher');
var firebaseURL = require('../firebase-url.js');
var MathFactsConstants = require('../constants/MathFactsConstants');

var CHANGE_EVENT = 'change';


/*
 * Default Data
 */

var _isLoaded = false;
/*
 * _data['factData'] = {
 *  'multiplication': [
 *    [[{data for 1x1}, {more data for 1x1}], [{data for 1x2}], [...]],
 *    [[{data for 2x1}, {more data for 2x1}], [{data for 2x2}], [...]],
 *    [...],
 *   ],
 *  'addition': [
 *    [[{data for 1+1}, {more data for 1+1}], [{data for 1+2}], [...]],
 *    [[{data for 2+1}, {more data for 2+1}], [{data for 2+2}], [...]],
 *    [...],
 *  ],
 *  'typing': [
 *    [{data for 1}, {more data for 1}], [{data for 2}], [...]
 *  ]
 *
 */
var defaultFactData = {
  'multiplication': null,
  'addition': null,
  'typing': null,
};

/*
 * Users are stored as an object with their id (int) and their name (string).
 * The UserList is an array of user objects
 */
var makeUser = function(userId, userName) {
  return {
    id: userId,
    name: userName,
    deleted: false,
  };
};

var makeDefaultUser = function() {
  return makeUser(0, 'Player');
};

var _data = {
  /*
   * Each Installation of the app has a uuid that (hopefully) makes it unique.
   *
   * We use the uuid as this installation's ID on Firebase.
   */
  uuid: null,

  // The active user is the key of the user in the userList
  activeUser: 0,
  userList: [makeDefaultUser()],
  points: 0,
  scores: [],

  factData: defaultFactData,
};


/*
 * Users
 */
var createKey = function(input) {
  var key = _data['activeUser'] + '-' + input;
  return key;
};

var addUser = function(userName) {
  var userId = _data['userList'].length;
  var newUser = makeUser(userId, userName);
  _data['userList'].push(newUser);
  changeActiveUser(userId);
  MathFactStore.emitChange();
  updateUserData().done();
};

var changeUserName = function(userName) {
  _data['userList'][_data['activeUser']].name = userName;
  MathFactStore.emitChange();
  updateUserData().done();
};

var changeActiveUser = function(id) {
  _data['activeUser'] = id;
  _isLoaded = false;
  updateUserData().then(fetchStoredData).done();
};

var updateUserData = function() {
  return Promise.all([
    AsyncStorage.setItem('activeUser', _data['activeUser'].toString()),
    AsyncStorage.setItem('userList', JSON.stringify(_data['userList'])),
  ]);
};


/*
 * Points
 */
var addPoints = function(amount) {
  _data['points'] += amount;
  _data['scores'].push(amount);
  MathFactStore.emitChange();
  updateStoredPoints();
};

var updateStoredPoints = function() {
  Promise.all([
    AsyncStorage.setItem(createKey('points'), _data['points'].toString()),
    AsyncStorage.setItem(createKey('scores'), JSON.stringify(_data['scores'])),
  ]).then(() => {
    updateRemoteStore();
  }).done();
};


/*
 * Adds fact attempts to the data store
 * Takes and operation and data as an array of attempts in the form:
 * [{inputs: [1, 2], data: {...}}, {inputs: [7, 4], data: {...}}]
 *
 */
var addAttempts = function(operation, data) {
  _.each(data, (attempt) => {
    var inputs = attempt.inputs;
    var attemptData = attempt.data;

    // Initialize the row if it's empty
    if (_data['factData'][operation][inputs[0]] == null) {
      _data['factData'][operation][inputs[0]] = [];
    }

    if (inputs.length === 1) {
      // If this operation takes a single input:
      _data['factData'][operation][inputs[0]].push(attempt);
    } else if (inputs.length === 2) {
      // If this operation takes two inputs:
      if (_data['factData'][operation][inputs[0]][inputs[1]] == null) {
        _data['factData'][operation][inputs[0]][inputs[1]] = [];
      }
      _data['factData'][operation][inputs[0]][inputs[1]].push(attemptData);
    }
  });
  updateStoredFactData();
};

var updateStoredFactData = function() {
  var key = createKey('factData');
  var value = JSON.stringify(_data['factData']);
  AsyncStorage.setItem(key, value).then(() => {
    updateRemoteStore();
  }).done();
};


/*
 * Update remate firebase storage
 */
var updateRemoteStore = function() {
  var uuid = _data['uuid'];
  if (firebaseURL && firebaseURL.length && uuid) {
    var firebaseRef = new Firebase(firebaseURL);

    var userRef = firebaseRef.child(uuid).child(_data['activeUser']);
    userRef.update({
      points: _data['points'],
      scores: _data['scores'],
      factData: _data['factData'],
    });
  }
};


// Clear all data
var clearData = function() {
  return Promise.all([
    AsyncStorage.removeItem(createKey('factData')),
    AsyncStorage.removeItem(createKey('points')),
    AsyncStorage.removeItem(createKey('scores'))
  ]).then(() => {
    return Promise.all([
      fetchPoints(),
      fetchFactData()
    ]);
  }).then(() => {
    MathFactStore.emitChange();
  }).done();
};


/*
 * Fetch data from AsyncStorage and load it into _data
 */
var fetchUserData = function() {
  return Promise.all([
    AsyncStorage.getItem('uuid').then((storedUuid) => {
      // If we already have a uuid in _data then we don't need to do anything
      if (_data['uuid'] != null) {
        return;
      };

      // If the stored uuid exists then we should use that
      if (storedUuid != null) {
        _data['uuid'] = storedUuid;
        return;
      };

      // If we don't have a uuid at all we should make one!
      _data['uuid'] = UuidGenerator.v1();
      return AsyncStorage.setItem('uuid', _data['uuid']);
    }),
    AsyncStorage.getItem('activeUser').then((user) => {
      _data['activeUser'] = (user == null) ? _data['activeUser'] : user;
    }),
    AsyncStorage.getItem('userList').then((userList) => {
      _data['userList'] = (userList == null) ? _data['userList'] : JSON.parse(userList);
    }),
  ]);
};

var fetchPoints = function() {
  return Promise.all([
    AsyncStorage.getItem(createKey('points')).then((points) => {
      _data['points'] = (points == null) ? 0 : parseInt(points);
    }),
    AsyncStorage.getItem(createKey('scores')).then((scores) => {
      _data['scores'] = (scores == null) ? [] : JSON.parse(scores);
    }),
  ]);
};

var fetchFactData = function() {
  return AsyncStorage.getItem(createKey('factData')).then((factData) => {
    var newFactData = {};
    var factData = JSON.parse(factData);
    if (factData == null) {
      factData = defaultFactData;
    }
    _.each(defaultFactData, (defaultData, operation) => {
      var data = factData[operation];
      newFactData[operation] = (data == null) ? [] : data;
    });
    _data['factData'] = newFactData;
  });
};

var fetchStoredData = function() {
  return fetchUserData().then(() => {
    return Promise.all([
      fetchPoints(),
      fetchFactData(),
    ]);
  }).then(() => {
    _isLoaded = true;
    MathFactStore.emitChange();
  }).done();
};


/*
 * Math Facts Store
 */
var MathFactStore = assign({}, EventEmitter.prototype, {

  /**
   * Get the entire database of Math Facts
   * @return {object}
   */
  isLoaded: function() {
    return _isLoaded;
  },

  getAll: function() {
    return _data['factData'];
  },

  getPoints: function() {
    return _data['points'];
  },

  getScores: function() {
    return _data['scores'];
  },

  getUuid: function() {
    return _data['uuid'];
  },

  getUser: function() {
    return _data['userList'][_data['activeUser']];
  },

  getUserList: function() {
    return _data['userList'];
  },

  emitChange: function() {
    this.emit(CHANGE_EVENT);
  },

  /**
   * @param {function} callback
   */
  addChangeListener: function(callback) {
    this.on(CHANGE_EVENT, callback);
  },

  /**
   * @param {function} callback
   */
  removeChangeListener: function(callback) {
    this.removeListener(CHANGE_EVENT, callback);
  }
});


// Register callback to handle all updates
AppDispatcher.register(function(action) {

  switch(action.actionType) {

    case MathFactsConstants.INITIALIZE:
      fetchStoredData();
      break;

    case MathFactsConstants.FACT_DATA_ADD:
      var operation = action.operation;
      var data = action.data;
      if (!_.isEmpty(data)) {
        addAttempts(operation, data);
      }
      break;

    case MathFactsConstants.POINTS_ADD:
      var amount = action.amount;
      addPoints(amount);
      break;

    case MathFactsConstants.DATA_CLEAR:
      clearData();
      break;

    case MathFactsConstants.USERS_ADD:
      var newUserName = action.name;
      addUser(newUserName);
      break;

    case MathFactsConstants.USERS_CHANGE_NAME:
      var newUserName = action.name;
      changeUserName(newUserName);
      break;

    case MathFactsConstants.USERS_CHANGE_ACTIVE_USER:
      var id = action.id;
      changeActiveUser(id);
      break;

    default:
      // no op
  }
});

module.exports = MathFactStore;