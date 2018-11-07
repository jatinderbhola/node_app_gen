var mongoose = require("mongoose");
var Schema = mongoose.Schema;

/*
* User
*
* A user object is a portable object within a given database. It only holds the username and password that is to be utilized to authenticate.
* A user needs to be attached to another object such as a staff or a customer in order to log into the system.
*
*/
var UserSchema = new Schema({
        username:String,
        auth_token : String,
        verify : String
    }, {
        collection:'user',
        timestamps:{createdAt:'created_at', updatedAt:'updated_at'}
    }
);

module.exports = {
	getModel: function(db){
        return db.model("User", UserSchema)
    },
	schema:UserSchema
};