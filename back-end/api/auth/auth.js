var bcrypt = require("bcrypt");
var _ = require("underscore");
var util = require("../../util");


/*
 * hashPassword
 *
 * Encrypts a password into a hash
 *
 */
var hashPassword = function(passwordString, callBack) {
    bcrypt.genSalt(10, function(err, salt) {
        bcrypt.hash(passwordString, salt, function(err, hash) {
            if (callBack) {
                callBack(err, hash);
            }
        });
    });
};


/*
 * verifyPassword
 *
 * Checks that a password matches a hash to authenticate it
 *
 */
var verifyPassword = function(password, hash, callBack) {
    bcrypt.compare(password, hash, function(err, res) {
        if (callBack) {
            callBack(err, res);
        }
    });
};

/*
 * getEffectivePermissions
 *
 * Unions all the permission sets defined by roles and directly on a user object and returns them concatenated
 *
 */
var getEffectivePermissions = function(db, userObj, callback) {
    var effectivePermissions = [];
    if (!_.isObject(userObj)) {
        if (_.isFunction(callback)) callback(effectivePermissions);
        return;
    }

    // loop through the permissions directly in the user object
    if (_.isArray(userObj.permissions) && userObj.permissions.length > 0) {
        for (var k = 0; k < userObj.permissions.length; k++) {
            var userPerm = userObj.permissions[k];
            // if the perm is an object and hasn't been added to the array add it now
            if (_.isObject(userPerm) && !util.isObjectInArray(effectivePermissions, userPerm, "_id")) {
                effectivePermissions.push(userPerm);
            }
        }
    }

    var pendingCallBacks = [];
    if (_.isArray(userObj.roles) && userObj.roles.length > 0) {
        var schemaCache = require("../../db/schema_cache");
        // loop through all the roles added to this userObj
        for (var i = 0; i < userObj.roles.length; i++) {
            var role = userObj.roles[i];

            if (_.isObject(role)) {
                // add this callback to a list, so we know how many we have pending
                pendingCallBacks.push(role._id);
                // load the role from cache (redis) to get the permissions associated with it
                schemaCache.get(
                    db,
                    "role",
                    role._id,
                    // localize effectivePermissions and roleId from the parent closure
                    function(effectivePermissions, roleId) {
                        return function(fullRole) {
                            if (_.isObject(fullRole)) {
                                // if the role has any permissions add each of the permissions one at a time
                                if (_.isObject(fullRole) && _.isArray(fullRole.permissions) && fullRole.permissions.length > 0) {
                                    for (var j = 0; j < fullRole.permissions.length; j++) {
                                        var rolePerm = fullRole.permissions[j];
                                        // if the perm is an object and hasn't been added to the array add it now
                                        if (_.isObject(rolePerm) && !util.isObjectInArray(effectivePermissions, rolePerm, "_id")) {
                                            effectivePermissions.push(rolePerm);
                                        }
                                    }
                                }
                            }
                            // remove this from the list of pending callbacks
                            // NOTE: we remove this callback even if the fullRole returned is not what we expected, this is because we need to return to our caller somehow!
                            var indexProp = pendingCallBacks.indexOf(roleId);
                            if (indexProp != -1) {
                                pendingCallBacks.splice(indexProp, 1);
                                // if we're done with all the callbacks, send the response
                                if (pendingCallBacks.length === 0) {
                                    if (_.isFunction(callback)) callback(effectivePermissions);
                                }
                            }
                        }; // returned function
                    }(effectivePermissions, role._id) // self invoking function
                );
            }
        }
    }

    // if we're done with all the callbacks, send the response
    if (pendingCallBacks.length === 0) {
        if (_.isFunction(callback)) callback(effectivePermissions);
    }

};

/*
 * hasPermission
 *
 * Evaluates whether a user has given permission
 *
 */
var hasPermission = function(db, userObj, permission, errCallback, successCallback) {
    getEffectivePermissions(db, userObj, function(effectivePermissions) {
        if (!_.isArray(effectivePermissions) || effectivePermissions.length === 0) {
            if (_.isFunction(errCallback)) errCallback();
            return;
        }

        if (_.isString(permission)) {
            permission = { _id: permission };
        }

        if (_.isObject(permission) && util.isObjectInArray(effectivePermissions, permission, "_id")) {
            if (_.isFunction(successCallback)) successCallback();
        } else {
            if (_.isFunction(errCallback)) errCallback();
        }
    });

};


/*
 * hasPermissionSync
 *
 * Evaluates whether a user has given permission, effectivePermissions must be provided
 *
 */
var hasPermissionSync = function(effectivePermissions, userObj, permission) {
    if (!_.isArray(effectivePermissions) || effectivePermissions.length === 0) {
        return false;
    }

    if (_.isString(permission)) {
        permission = { _id: permission };
    }

    if (_.isObject(permission) && util.isObjectInArray(effectivePermissions, permission, "_id")) {
        return true;
    }

    return false;

};


/*
 * hasOneOfPermissionSync
 *
 * Evaluates whether a user has given permission, effectivePermissions must be provided
 *
 */
var hasOneOfPermissionSync = function(effectivePermissions, userObj, permissions) {
    if (!_.isArray(effectivePermissions) || effectivePermissions.length === 0) {
        return false;
    }
    if (!_.isArray(permissions) || permissions.length === 0) {
        return false;
    }

    for (var i = 0; i < permissions.length; i++) {
        var permission = permissions[i];
        if (_.isString(permission)) {
            permission = { _id: permission };
        }

        if (_.isObject(permission) && util.isObjectInArray(effectivePermissions, permission, "_id")) {
            return true;
        }
    }

    return false;

};


/*
 * hasOneOfPermission
 *
 * Evaluates whether a user has at least one of the permissions specified
 *
 */
var hasOneOfPermission = function(db, userObj, permissions, errCallback, successCallback) {
    getEffectivePermissions(db, userObj, function(effectivePermissions) {

        if (!_.isArray(effectivePermissions) || effectivePermissions.length === 0) {
            if (_.isFunction(errCallback)) errCallback();
            return;
        }
        if (!_.isArray(permissions) || permissions.length === 0) {
            if (_.isFunction(errCallback)) errCallback();
            return;
        }

        for (var i = 0; i < permissions.length; i++) {
            var permission = permissions[i];
            if (_.isString(permission)) {
                permission = { _id: permission };
            }

            if (_.isObject(permission) && util.isObjectInArray(effectivePermissions, permission, "_id")) {
                if (_.isFunction(successCallback)) successCallback();
                return;
            }
        }

        if (_.isFunction(errCallback)) errCallback();


    });

};



/*
 * hasAllPermission
 *
 * Evaluates whether a user has all the permissions specified
 *
 */
var hasAllPermission = function(db, userObj, permissions, errCallback, successCallback) {
    getEffectivePermissions(db, userObj, function(effectivePermissions) {
        if (!_.isArray(effectivePermissions) || effectivePermissions.length === 0) {
            if (_.isFunction(errCallback)) errCallback();
            return;
        }
        if (!_.isArray(permissions) || permissions.length === 0) {
            if (_.isFunction(errCallback)) errCallback();
            return;
        }

        for (var i = 0; i < permissions.length; i++) {
            var permission = permissions[i];
            if (_.isString(permission)) {
                permission = { _id: permission };
            }

            if (!_.isObject(permission) || !util.isObjectInArray(effectivePermissions, permission, "_id")) {
                if (_.isFunction(errCallback)) errCallback();
                return;
            }
        }

        if (_.isFunction(successCallback)) successCallback();
    });


};


module.exports = {
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    getEffectivePermissions: getEffectivePermissions,
    hasPermission: hasPermission,
    hasPermissionSync: hasPermissionSync,
    hasOneOfPermissionSync: hasOneOfPermissionSync,
    hasOneOfPermission: hasOneOfPermission,
    hasAllPermission: hasAllPermission
};