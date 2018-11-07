var mongoose = require("mongoose");
var Schema = mongoose.Schema;
var namedRefSchema = require("./named_ref");
var provinceRefSchema = require("../api/models/working/province").schema;



/*

 TokenRefSchema is an embedded schema very similar to NamedRef (See named_ref.js) but instead of an ObjectId "_id" it uses a string
 
 This allows to store refs to objects which ids are plain strings like "MY_ID" instead of the regular mongodb hex _ids.
 
*/
var AddressRefSchema = Schema({
    buildingType: String,
    buzzCode: String,
    unitNumber: String,
    address: String,
    city: String,
    countrySubdivision: namedRefSchema,
    country: String,
    postalCode: String,
    majorIntersection: String,
    zoneA: namedRefSchema,
    zoneB: namedRefSchema,
    attention: String, //A common abbreviation for the word "attention". The abbreviation "attn: " is often used within companies in addressing memorandums, mailings and other written business communications to the individual or group who should pay the most attention to them.
    relation: String,
    note: String,
    deliveryNotes: String,
    province: provinceRefSchema
}, { _id: false });


module.exports = AddressRefSchema;