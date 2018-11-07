/*
This is a single field to be used in other schemas. The reason we have it separate like this is to avoid
duplicating the same enum in many different places. 
*/

module.exports = {
    type: String,
    enum: [
        "PENDING",
        "APPROVED",
        "REJECTED"
    ]
};