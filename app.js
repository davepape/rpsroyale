const express = require('express');
let app = express();

/* Use EJS for templates (in the "views" folder) */
app.set('view engine', 'ejs');

/* Enable session data for all connections to this site */
const session = require('express-session');
const MongoStore = require('connect-mongo');
const sess_uri = process.env.ATLAS_RPSR_SESSION_URI;

app.use(session({ secret: 'fnord',
                  store: MongoStore.create({ mongoUrl: sess_uri }),
                  resave: false,
                  saveUninitialized: false,
                  cookie: { maxAge: 365*24*60*60*1000 }}))


/* Assuming all our pages are dynamically generated, this tells browsers not to cache anything.  */
app.use(function (req,res,next) {
    res.set('Cache-Control','no-store');
    next();
    });

/* Use body-parser for any input forms on the site */
const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({extended:false}));

/* This allows static files in the "public" folder to be served when running this app via the command-line, rather than via Passenger */
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', require('./rpsroyale.js'));

let server = app.listen(8079, function () {});
