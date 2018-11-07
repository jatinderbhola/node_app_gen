var mongoose = require("mongoose");
var Schema = mongoose.Schema;


/*

 TokenRefSchema is an embedded schema very similar to NamedRef (See named_ref.js) but instead of an ObjectId "_id" it uses a string
 
 This allows to store refs to objects which ids are plain strings like "MY_ID" instead of the regular mongodb hex _ids.
 
*/
var TokenRefSchema = Schema({
        _id:String, 
        value:Number, // for ranking and sorting
        name:String
    },
    {_id: false}
);


module.exports = TokenRefSchema;