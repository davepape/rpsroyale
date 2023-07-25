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



async function index(req, res) {
    if (req.session.rpsr_user_id)
        home(req, res);
    else
        welcomePage(req, res);
    }

async function welcomePage(req, res) {
    res.render('welcome', { username: ""} );
    }

async function aboutPage(req, res) {
    let username = req.session.username;
    res.render('about', { username: username });
    }

async function attackPage(req, res) {
    let username = req.session.username;
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: { $ne: ObjectID(req.session.rpsr_user_id) } };
    collection.find(query).toArray(async function (err, result) {
        let others = [];
        for (let i=0; i < result.length; i++)
            {
            if (!(result[i].screenname in others))
                others.push(result[i]);
            }
        res.render('attack', { username: username, otherplayers: others });
        });
    }

async function defendPage(req, res) {
    let username = req.session.username;
    res.render('defend', { username: username });
    }

async function scoreboardPage(req, res) {
    let username = req.session.username;
    res.render('scoreboard', { username: username });
    }

async function settingsPage(req, res) {
    let username = req.session.username;
    res.render('settings', { username: username });
    }

async function resultsPage(req, res) {
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user_id) };
    let operation = { $set: { hasNewResults: false } };
    collection.updateOne(query, operation, function (err,result) {
        if (err) { throw err; }
        let username = req.session.username;
        res.render('results', { username: username });
        });
    }


async function home(req, res) {
    if (!req.session.rpsr_user_id) { return res.redirect('welcome'); }
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user_id) };
    collection.findOne(query, async function (err, result) {
        if (err) { console.log(err); return res.sendStatus(500); }
        res.render('home', { user: result, username: result.screenname });
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


async function makeDefense(req,res) {
    if (!req.session.rpsr_user_id) { return res.redirect('welcome'); }
    let move = getMove(req.body);
    let username = req.session.username;
    console.log(`makeDefense ${username} ${move}`);
    useActionPoint(req, async function (err, result) {
            if (result.matchedCount > 0)
                {
                let db = await getDb();
                let collection = db.collection("plays");
                let play = { playername: username,
                            playerid: req.session.rpsr_user_id,
                            move: move,
                            taunt: "Your mother was a hamster",
                            timestamp: Date.now()
                            };
                collection.insertOne(play, function (err,result) {
                    if (err) { console.log(err); return res.sendStatus(500); }
                    res.redirect('home');
                    });
                }
            else
                {
                res.render('nopoints', { username: username });
                }
            });
    }

async function makeAttack(req,res) {
    if (!req.session.rpsr_user_id) { return res.redirect('welcome'); }
    let move = getMove(req.body);
    let otherid = req.body.otherid;
    let username = req.session.username;
    console.log(`makeAttack ${username} ${move} ${otherid}`);
    res.redirect('/');
    }

async function useActionPoint(req, callback) {
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user_id), actionpoints: { $gte: 1 } };
    let operation = { $inc: { actionpoints: -1 } };
    collection.updateOne(query, operation, callback);
    }

function getMove(body) {
    if (body.rock) return 'rock';
    if (body.paper) return 'paper';
    if (body.scissors) return 'scissors';
    return 'cheat';
    }

/*
async function scoreboard(req, res) {
    let db = await getDb();
    let collection = db.collection("users");
    return await collection.find().sort({points:-1}).toArray(function (err,result) {
        if (err) { console.log(err); return res.sendStatus(500); }
        res.render('scoreboard', { players: result, user: req.session.rpsr_user });
        });
    }
*/



async function match(req, res) {
    if (!req.session.rpsr_user_id) { return res.redirect('welcome'); }
    let db = await getDb();
    let collection = db.collection("plays");
    let query = { playerid: { $ne: req.session.rpsr_user_id } };
    collection.find(query).toArray(function (err, result) {
        if (err) { console.log(err); return res.sendStatus(500); }
        res.render('match', { user: req.session.rpsr_user, plays: result });
        });
    }


async function makematch(req,res) {
    if (!req.session.rpsr_user_id) { return res.redirect('welcome'); }
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
        let resultRecord = { player1: { id: req.session.rpsr_user_id,
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
        updatePlayerPoints(req.session.rpsr_user_id, matchRes.mypoints);
        updatePlayerPoints(play.playerid, matchRes.otherpoints);
        res.render('matchresult', { user: req.session.rpsr_user_id, match: match, matchRes: matchRes });
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


async function validateStake(req) {
    let stake = parseInt(req.body.stake);
    if (isNaN(stake) || (stake < 1)) {
        console.log(`${req.session.rpsr_user.screenname} tried to stake "${req.body.stake}"`);
        return 1;
        }
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user_id) };
    let u = await collection.findOne(query);
    if (stake > u.points) {
        console.log(`${req.session.rpsr_user.screenname} tried to stake "${req.body.stake}" but only has ${u.points} points`);
        return u.points;
        }
    return stake;
    }




/*
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
*/

async function newAccount(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { return res.render('error', { errors: errors.array() }); }
    let db = await getDb();
    let collection = db.collection("users");
    let query = { screenname: new RegExp(`^${req.body.yourname}$`,'i') };
    let numExisting = await collection.count(query);
    if (numExisting == 0) {
        let obj = { screenname: req.body.yourname, email: "", password: "x", actionpoints: STARTING_POINTS, hasNewResults: true };
        collection.insertOne(obj, function (err,result) {
            if (err) { console.log(err); return res.sendStatus(500); }
            req.session.rpsr_user_id = result.insertedId;
            req.session.username = obj.screenname;
            res.redirect(`home`);
            });
        }
    else {
        res.redirect(`/newaccounterror`);
        }
    }


function loginError(req, res) {
    res.render('loginerror', { username: "" });
    }


function newAccountError(req, res) {
    res.render('newaccounterror', { username: "" });
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
router.get('/scoreboard', scoreboardPage);
router.get('/attack', attackPage);
router.get('/defend', defendPage);
router.get('/settings', settingsPage);
router.get('/results', resultsPage);
router.post('/makedefense', makeDefense);
router.post('/makeattack', makeAttack);
router.get('/match', match);
router.post('/makematch', makematch);
router.get('/logout', logout);
router.get('/loginerror', loginError);
router.post('/newaccount', newAccount);
router.get('/newaccounterror', newAccountError);

module.exports = router;
