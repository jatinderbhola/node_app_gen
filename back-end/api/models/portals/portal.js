var mongoose = require("mongoose");
var Schema = mongoose.Schema;
var namedRefSchema = require("../../../db/named_ref");
var tokenRefSchema = require("../../../db/token_ref");
var moment = require("moment");

//=============================================
// --- PLEASE NOTE - Portal is defined in a different database than the rest of this models. There is no link between them at all
//=============================================
var CompanyAddress = new Schema({
    name: { type: String, default: '' },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    province: namedRefSchema,
    postal: { type: String, default: '' },
    country: namedRefSchema,
    phone: { type: String, default: '' },
    fax: { type: String, default: '' },
    email: { type: String, default: '' },
    website: { type: String, default: '' },
});
var showroomSchema = new Schema({
    consignment: {
        splitRatio: Number
    }
}, {
    _id: false
});

var BarcodeOptionSchema = new Schema({
    format: { type: String, default: 'CODE39' },
    lineColor: { type: String, default: '#000000' },
    width: { type: String, default: '2' },
    height: { type: String, default: '100' },
    font: { type: String, default: 'arial' },
    displayValue: { type: Boolean },
    textAlign: { type: String, default: 'center' },
    textPosition: { type: String, default: 'bottom' },
    background: { type: String, default: '#FAFAFA' },
    marginTop: { type: Number, default: '10' },
    marginBottom: { type: Number, default: '2' },
    marginLeft: { type: Number, default: '10' },
    marginRight: { type: Number, default: '10' },
    fontSize: { type: Number, default: '20' },
    fontOptions: { type: String, default: 'bold' },

}, {
    _id: false
});

var PortalSchema = new Schema({
    name: String,
    url: String,
    database: String,
    photo_bucket: String, // s3 bucket to use for this portal

    logo: String,
    logo_url: String,
    thumbnail_url: String,

    primary_color: String,
    accents_color: String,
    notes: String,
    payroll: Schema({
        frequency: tokenRefSchema, //payroll_frequency
        start_stamp: Schema.Types.Number,
        current_period_start: { type: Date },
        max_weekly_regular_hours: Number,
        overtime_rate: Number,
        default_daily_break_hours: Number,
        daily_break_paid: Boolean,
        default_daily_meal_break_hours: Number,
        daily_meal_break_paid: Boolean,
        separate_stubs_commission_payments: Boolean
    }),
    default_tax_type: namedRefSchema,
    default_term: namedRefSchema,
    //===== order number ========
    order_prefix: String,
    order_padding: Number,
    order_increment: Number,

    //===== order number ========
    stock_prefix: String,
    stock_padding: Number,
    stock_increment: Number,


    //======== company setting =========
    company: CompanyAddress,

    app_mode_list: [tokenRefSchema],

    classification_list: [tokenRefSchema],

    location_list: [{
        _id: { type: String, unique: true },
        name: { type: String, default: '' },
        address: CompanyAddress
    }],

    gs1_code: { type: String, default: '000000', maxlength: 10 },

    barcodeOption: BarcodeOptionSchema,
    showroomconfig: showroomSchema,



}, {
    collection: 'portal',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

PortalSchema.virtual('payroll_active_period').get(function() {
    if (this.current_period_start === null || this.current_period_start === undefined) {
        return null;
    }
    if (this.frequency === null || this.frequency === undefined) {
        return null;
    }

    var start = this.current_period_start;
    var startMoment = moment.unix(start).utc();
    var endMoment = null;


    switch (this.frequency._id.toString()) {
        case "DAILY":
            endMoment = startMoment.add(1, 'd');
            break;
        case "WEEKLY":
            endMoment = startMoment.add(1, 'w');
            break;
        case "BIWEEKLY":
            endMoment = startMoment.add(2, 'w');
            break;
        case "SEMIMONTHLY":
            if (startMoment.get("date") === 1) {
                endMoment = moment(startMoment);
                endMoment.day(15);
            } else {
                endMoment = startMoment.add(1, 'M');
                endMoment = endMoment.startOf("month");
            }
            break;
        case "MONTHLY":
            endMoment = startMoment.add(1, 'M');
            break;
    }

    if (endMoment !== null) {
        var end = endMoment.unix();
        return {
            start: start,
            end: end
        }
    }

    return null;
});

module.exports = {
    getModel: function(db) {
        return db.model("Portal", PortalSchema);
    },
    schema: PortalSchema
};