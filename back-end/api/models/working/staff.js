var mongoose = require("mongoose");
var _ = require("underscore");
var Schema = mongoose.Schema;
var namedRefSchema = require("../../../db/named_ref");
var TokenRefSchema = require("../../../db/token_ref");
var auth = require("../../auth/auth");
// var permissionSchema = require("./permission");


var CommissionRefList = new Schema({
    eid: String,
    _id: false,
    name: String,
    percentage: {
        type: Number,
        min: 0,
        max: 100
    },
    productRef: TokenRefSchema,
    categoryRef: TokenRefSchema
});

/*
 * Staff
 *
 * A staff object holds all the information related to a person who is employed at a specific portal, this includes its roles and permissions with the organization
 * Notably, it does not contain a username and password, these are defined in a user collection. A user must be linked to records of staff in order to allow them to log in
 *
 * This user portability also means that a user object can be attached to another valid receptor such as a customer and people will be able to log in with the same user and password 
 * as a customer or staff depending on the end point used. Only one user is allowed per endpoint.
 *
 */
var StaffSchema = new Schema({
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    roles: [TokenRefSchema], // the roles this customer has. NOTE: this is not embedding the entire role, this is because if the role changes we want the privileges of this user to change.. I.e. each user shouldn't have its own version of the role
    //permissions: [permissionSchema.embeddableSchema], // these are permissions defined directly in the staff object, the add to the permissions defined by the roles

    //personal details
    first_name: String, //
    middle_name: String,
    last_name: String, //
    street: String, //
    street2: String, //
    city: String, //
    province: namedRefSchema, //
    country: {
        type: String,
        enum: ["CA", "US"]
    },
    postal: String, //
    personal_cell: String,
    home_cell: String,
    email: String, //
    date_of_birth: {
        type: Date
    }, //

    //family details
    spouse_name: String,
    emergency_contact_name_primary: String,
    emergency_contact_number_primary: String,
    emergency_contact_name_secondary: String,
    emergency_contact_number_secondary: String,

    //work details
    start_date: {
        type: Date
    },
    salary: Number, //
    salary_type: namedRefSchema, //
    position_list: [{
        department: namedRefSchema,
        position: namedRefSchema,
        eid: String,
        _id: false
    }, ],
    app_mode_list: [namedRefSchema],
    commission_scheme: namedRefSchema, // will not be used anymore
    commissionList: [CommissionRefList],
    separate_commission_paystub_type: Boolean,

    company_vehicle_driver: Boolean,
    license_number: String,

    company_card_issue: Boolean,
    company_card_issue_number: String,

    key_issued: Boolean,
    key_issued_number: String,

    committees: Boolean,
    committees_number: String,

    company_opt: Boolean,
    company_opt_number: String,

    //vacation days
    used_vacation_days: Number,
    allowed_vacation_days: Number,
    allowed_sick_days: Number,

    notes: String, //



    family_members: [{
        name: String,
        relationship: String
    }],
    raise_history: [Schema({
        date: Date,
        raise_percent: {
            type: Number,
            min: 1,
            max: 100
        }
    }, {
        _id: false
    })],
    expenses: [{
            description: String,
            amount: Number
        }] //,
        // commission_scheme:[{ //
        //     service : {type:Schema.Types.ObjectId, ref:'Service'}, //change Service to CommissionScheme
        //     commission_percent : {type:Number, min:1, max:100}
        // }]

}, {
    collection: 'staff',
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    },
    toJSON: {
        virtuals: true
    }
});

StaffSchema.virtual('name').get(function() {

    if (!this.last_name) {
        return this.first_name
    } else if (!this.first_name) {
        return this.last_name
    } else {
        // return this.first_name + ' ' + this.last_name;
        return this.last_name + ', ' + this.first_name;

    }

});

StaffSchema.virtual('address').get(function() {
    return this.street + ', ' + this.street2 + ', ' + this.city + ', ' + this.province + ', ' + this.country + ', ' + this.postal;
});

StaffSchema.methods.loadReferences = function(db, filledModel, callback) {
    auth.getEffectivePermissions(db, this, function(permissions) {
        filledModel.effective_permissions = permissions;
        if (_.isFunction(callback)) callback();
    });
};

module.exports = {
    getModel: function(db) {
        return db.model("Staff", StaffSchema)
    },
    // returning limited rows, sorted by date - last on top.
    last: function(value) { // query function call by router.route("/:model/:query_function/:value") 
        if (!value) value = "20";

        var rows = parseInt(value);
        if (typeof rows === 'number' && rows > 0) {

            var query = {
                _filter: {},
                _projection: "_id first_name middle_name last_name street street2 city province country postal personal_cell home_cell email date_of_birth name address",
                _limit: parseInt(value),
                _order: {
                    "name": 1
                }
            }; //var query = {};
            return query;
        } else {
            console.log("staff last function missing parameter");
        }
    },

    multi: function(value) {
        if (value) {

            var query = {
                _filter: {
                    "$or": [{ "first_name": { "$regex": value, "$options": "i" } },
                        { "last_name": { "$regex": value, "$options": "i" } }
                    ]
                },
                _projection: "_id first_name middle_name last_name street street2 city province country postal personal_cell home_cell email date_of_birth name address",
                _limit: 10
            };
            return query;
        } else {
            console.log("Staff multi function missing parameter");
        }
    },
    eids: {
        "position_list": ["department", "position"],
        "commissionList": ["name", "percentage", "categoryRef"]
    },

    /**
     * search from staff.commissionList._id
     */
    getCommissionById: function(value) {
        if (value) {
            var query = {
                _filter: {
                    "commissionList._id": value
                }
            };
            return query;
        } else {
            console.log("Staff getCommissionById value missing or null");
        }
    },

    /**
     * search by staff.commissionList.productRef._id ||  staff.commissionList.categoryRef._id 
     */
    getCommissionByItemId: function(value) {
        if (value) {
            var query = {
                _filter: {
                    "$or": [
                        { "commissionList.productRef._id": value },
                        { "commissionList.categoryRef._id ": value }
                    ]
                },
            };
            return query;
        } else {
            console.log("Staff getCommissionByItemId value missing or null");
        }
    },
    schema: StaffSchema
};