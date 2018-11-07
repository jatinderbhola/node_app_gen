var _ = require("underscore");

var isObjectInArray = function(array, object, field) {
    return (
        _.findIndex(
            array,
            function(existingItem) {
                return (_.isObject(existingItem) && _.isObject(object) && existingItem[field] === object[field]);
            }
        ) != -1
    );
};

module.exports = {
    isObjectInArray: isObjectInArray
};