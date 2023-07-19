/* This version of "rpsroyale" uses a series of Promises in the home() function,
 instead of using 'await'.  Doing this as a test of that approach, to try to
 see which seems more understandable.
 This approach is in theory better because it maintains more asynchrony.
*/
const path = require('path');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const { MongoClient, ServerApiVersion, ObjectID } = require('mongodb');
const uri = process.env.ATLAS_URI;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

const STARTING_POINTS = 10;

var _db;
async function getDb() {
    if (!_db)
        {
        await client.connect();
        _db = await client.db("rpsroyale");
        }
    return _db;
    }



function welcomePage(req, res) {
    res.render('welcome');
    }


function aboutPage(req, res) {
    res.render('about');
    }

function attackPage(req, res) {
    res.render('attack');
    }

function defendPage(req, res) {
    res.render('defend');
    }

function scoreboardPage(req, res) {
    res.render('scoreboard');
    }

function settingsPage(req, res) {
    res.render('settings');
    }

function resultsPage(req, res) {
    res.render('results');
    }


async function index(req, res) {
    if (req.session.rpsr_user)
        home(req, res);
    else
        welcomePage(req, res);
    }


async function home(req, res) {
    if (!req.session.rpsr_user) { return res.redirect('loginpage'); }
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user._id) };
    collection.findOne(query, async function (err, result) {
        if (err) { console.log(err); return res.sendStatus(500); }
        findPlayerResults(req.session.rpsr_user._id).then(function (myresults) {
            findPlayerPlays(req.session.rpsr_user._id).then(function (myplays) {
                res.render('home', { user: result, results: myresults, plays: myplays });
                });
            });
        });
    }

async function findPlayerResults(playerid) {
    let db = await getDb();
    return new Promise(function (resolve, reject) {
        let collection = db.collection("results");
        let query = { $or: [ { 'player1.id': playerid },
                            { 'player2.id': playerid }]};
        collection.find(query).toArray(function(err, res) {
            if (err)
                reject(err);
            let mergedResults = [];
            for (let i=0; i < res.length; i++) {
                let obj = { time: printableTime(res[i].time) };
                if (res[i].player1.id == playerid) {
                    obj.otherPlayer = res[i].player2.name;
                    obj.points = res[i].player1.points;
                    obj.result = res[i].result;
                    }
                else {
                    obj.otherPlayer = res[i].player1.name;
                    obj.points = res[i].player2.points;
                    obj.result = oppositeResult(res[i].result);
                    }
                mergedResults.push(obj);
                }
            resolve(mergedResults);
            });
        });
    }

async function findPlayerPlays(playerid) {
    let db = await getDb();
    return new Promise(function (resolve, reject) {
        let collection = db.collection("plays");
        let query = { playerid: playerid };
        collection.find(query).toArray(function (err,result) {
            if (err)
                reject(err);
            resolve(result);
            });
        });
    }

/*
async function home(req, res) {
    if (!req.session.rpsr_user) { return res.redirect('loginpage'); }
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user._id) };
    collection.findOne(query, async function (err, result) {
        if (err) { console.log(err); return res.sendStatus(500); }
        let myresults = await findPlayerResults(req.session.rpsr_user._id);
        let myplays = await findPlayerPlays(req.session.rpsr_user._id);
        res.render('home', { user: result, results: myresults, plays: myplays });
        });
    }

async function findPlayerResults(playerid) {
    let db = await getDb();
    let collection = db.collection("results");
    let query = { $or: [ { 'player1.id': playerid },
                         { 'player2.id': playerid }]};
    res = await collection.find(query).toArray();
    let mergedResults = [];
    for (let i=0; i < res.length; i++) {
        let obj = { time: printableTime(res[i].time) };
        if (res[i].player1.id == playerid) {
            obj.otherPlayer = res[i].player2.name;
            obj.points = res[i].player1.points;
            obj.result = res[i].result;
            }
        else {
            obj.otherPlayer = res[i].player1.name;
            obj.points = res[i].player2.points;
            obj.result = oppositeResult(res[i].result);
            }
        mergedResults.push(obj);
        }
    return mergedResults;
    }


async function findPlayerPlays(playerid) {
    let db = await getDb();
    let collection = db.collection("plays");
    let query = { playerid: playerid };
    return await collection.find(query).toArray();
    }
*/


function printableTime(t) {
    let d = new Date(t);
    return d.toLocaleDateString('en-us', { month: "short", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric"});
    }


function oppositeResult(r) {
    if (r == 'W')
        return 'L';
    else if (r == 'L')
        return 'W';
    else
        return r;
    }


async function scoreboard(req, res) {
    let db = await getDb();
    let collection = db.collection("users");
    return await collection.find().sort({points:-1}).toArray(function (err,result) {
        if (err) { console.log(err); return res.sendStatus(500); }
        res.render('scoreboard', { players: result, user: req.session.rpsr_user });
        });
    }


function newplay(req, res) {
    if (!req.session.rpsr_user) { return res.redirect('loginpage'); }
    res.render('newplay', { user: req.session.rpsr_user });
    }


async function makeplay(req,res) {
    if (!req.session.rpsr_user) { return res.redirect('loginpage'); }
    let move = getMove(req.body);
    let stake = await validateStake(req);
    console.log(`makeplay ${req.session.rpsr_user.screenname} ${stake} ${move}`);
    let play = { playername: req.session.rpsr_user.screenname,
                 playerid: req.session.rpsr_user._id,
                 stake: stake,
                 move: move
                };
    updatePoints(req, stake);
    let db = await getDb();
    let collection = db.collection("plays");
    collection.insertOne(play, function (err,result) {
        if (err) { console.log(err); return res.sendStatus(500); }
        res.redirect('home');
        });
    }


async function match(req, res) {
    if (!req.session.rpsr_user) { return res.redirect('loginpage'); }
    let db = await getDb();
    let collection = db.collection("plays");
    let query = { playerid: { $ne: req.session.rpsr_user._id } };
    collection.find(query).toArray(function (err, result) {
        if (err) { console.log(err); return res.sendStatus(500); }
        res.render('match', { user: req.session.rpsr_user, plays: result });
        });
    }


async function makematch(req,res) {
    if (!req.session.rpsr_user) { return res.redirect('loginpage'); }
    console.log(`makematch ${req.body.play} ${getMove(req.body)}`);
    let mymove = getMove(req.body);
    let mystake = await validateStake(req);
    let db = await getDb();
    let collection = db.collection("plays");
    let query = { _id: ObjectID(req.body.play) };
    collection.findOneAndDelete(query).then(function (result) {
        let play = result.value;
        if (!play) { return res.render('matchfailed'); }
        let match = { mymove: mymove, opp: play.playername, oppmove: play.move };
        let matchRes = resolveMatch(mymove, play.move, mystake, play.stake);
        let resultRecord = { player1: { id: req.session.rpsr_user._id,
                                        name: req.session.rpsr_user.screenname,
                                        points: matchRes.mypoints },
                             player2: { id: play.playerid,
                                        name: play.playername,
                                        points: matchRes.otherpoints },
                             time: Date.now(),
                             result: matchRes.result
                            };
        db.collection("results").insertOne(resultRecord, function (err,result) {
            if (err) { console.log(err); }
            });
        updatePlayerPoints(req.session.rpsr_user._id, matchRes.mypoints);
        updatePlayerPoints(play.playerid, matchRes.otherpoints);
        res.render('matchresult', { user: req.session.rpsr_user, match: match, matchRes: matchRes });
        }).catch(function (err) { console.log(err); return res.sendStatus(500); });
    }


async function updatePlayerPoints(playerid, points) {
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(playerid) };
    let operation = { $inc: { points: points } };
    collection.updateOne(query, operation, function (err,res) {
        if (err) { throw err; }
        console.log(`changed ${playerid} points by ${points}`);
        });
    }


function resolveMatch(mymove, othermove, mystake, otherstake)
    {
    let minstake = Math.min(mystake, otherstake);
    if (mymove == othermove) {
        return { result: 'T', mypoints: 0, otherpoints: 0 };
        }
    else if (((mymove == 'rock') && (othermove == 'scissors')) ||
             ((mymove == 'paper') && (othermove == 'rock')) ||
             ((mymove == 'scissors') && (othermove == 'paper'))) {
        return { result: 'W', mypoints: minstake, otherpoints: -otherstake };
        }
    else {
        return { result: 'L', mypoints: -mystake, otherpoints: minstake };
        }
    }

function getMove(body) {
    if (body.rock) return 'rock';
    if (body.paper) return 'paper';
    if (body.scissors) return 'scissors';
    return 'cheat';
    }


async function validateStake(req) {
    let stake = parseInt(req.body.stake);
    if (isNaN(stake) || (stake < 1)) {
        console.log(`${req.session.rpsr_user.screenname} tried to stake "${req.body.stake}"`);
        return 1;
        }
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user._id) };
    let u = await collection.findOne(query);
    if (stake > u.points) {
        console.log(`${req.session.rpsr_user.screenname} tried to stake "${req.body.stake}" but only has ${u.points} points`);
        return u.points;
        }
    return stake;
    }


async function updatePoints(req,stake) {
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user._id) };
    let operation = { $inc: { points: -stake } };
    collection.updateOne(query, operation, function (err,res) {
        if (err) { throw err; }
        console.log(`reduced ${req.session.rpsr_user.screenname} points by ${stake}`);
        });
    }



async function login(req, res) {
    let db = await getDb();
    let collection = db.collection("users");
    let query = { email: new RegExp(`^${req.body.username}$`,'i') };
    collection.findOne(query, async function (err,result) {
        if (err) { response.send(err); }
        if (result)
            {
            let ok = await bcrypt.compare(req.body.password, result.password);
            if (ok) {
                req.session.rpsr_user = result;
                res.redirect(`home`);
                }
            else {
                res.redirect(`loginerror`);
                }
            }
        else {
            res.redirect(`loginerror`);
            }
        });
    }


async function newAccount(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { return res.render('error', { errors: errors.array() }); }
    let db = await getDb();
    let collection = db.collection("users");
    let query = { email: new RegExp(`^${req.body.username}$`,'i') };
    let numExisting = await collection.count(query);
    if (numExisting == 0) {
        let passwordhash = await bcrypt.hash(req.body.password, 10);
        let obj = { email: req.body.username, screenname: req.body.screenname, password: passwordhash, profile: req.body.profile, points: STARTING_POINTS };
        collection.insertOne(obj, function (err,result) {
            if (err) { console.log(err); return res.sendStatus(500); }
            login(req,res);
            });
        }
    else {
        res.redirect(`/newaccounterror`);
        }
    }


function loginError(req, res) {
    res.render('loginerror');
    }


function newAccountError(req, res) {
    res.render('newaccounterror');
    }


function logout(req, res) {
    req.session.destroy(function (err) {
        if (err) { console.log(err); return res.sendStatus(500); }
        res.redirect(`.`);
        });
    }



const express = require('express');
let router = express.Router();

router.get('/', index);
router.get('/home', home);
router.get('/welcome', welcomePage);
router.get('/about', aboutPage);
router.get('/scoreboard', scoreboard);
router.get('/attack', attackPage);
router.get('/defend', defendPage);
router.get('/settings', settingsPage);
router.get('/results', resultsPage);
router.get('/newplay', newplay);
router.post('/makeplay', makeplay);
router.get('/match', match);
router.post('/makematch', makematch);
router.post('/login', login);
router.get('/logout', logout);
router.get('/loginerror', loginError);
router.post('/newaccount', body('username').isEmail(), body('password').isLength({min:5}), newAccount);
router.get('/newaccounterror', newAccountError);

module.exports = router;
