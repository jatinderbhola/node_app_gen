var mongoose = require("mongoose");
var Schema = mongoose.Schema;


/*

 NamedRef is an embedded schema to be used instead of a simple ref. This includes the name in addition to the id, so that we may show it in lists
 - Notice that we're not exporting this as a model and we're not using the 'new' keyword. We're following the exact sintax used to define embedded schemas in mongoose.
  Mongoose doesn't allow nesting schemas unless you're using refs or are part of an array. This sintax allows us to use it as an embedded schema, but defined in a single place
 
 Use it like this:



var namedRefSchema = require("../../db/id_ref");

var TimeLogSchema = new Schema({
        staff : namedRefSchema, // a reference to the staff including the name
        ..
   })

 - Using namedRef might mean mongoose population stops working, that's a tradeoff we're willing to live with, the whole idea of namedRef is to avoid population in situations where
   only a name is required (such as displaying the main entity in a grid). Loading the rest of the properties of the object referenced in the namedRef would require a separate request 
*/
var NamedRefSchema = Schema({
        _id:Schema.Types.ObjectId, 
        value:Number, // for ranking and sorting
        name:String
    },
    {_id: false}
);


module.exports = NamedRefSchema;