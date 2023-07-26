const path = require('path');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

const { MongoClient, ServerApiVersion, ObjectID } = require('mongodb');
const uri = process.env.ATLAS_URI;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

const STARTING_POINTS = 10;
let logToConsole = false;
if (process.env.RPSR_LOG_TO_CONSOLE)
    logToConsole = true;

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
    res.render('about', { username: req.session.username });
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
        res.render('attack', { username: req.session.username, otherplayers: others });
        });
    }

async function defendPage(req, res) {
    res.render('defend', { username: req.session.username });
    }

async function scoreboardPage(req, res) {
    res.render('scoreboard', { username: req.session.username });
    }

async function settingsPage(req, res) {
    res.render('settings', { username: req.session.username });
    }

async function resultsPage(req, res) {
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user_id) };
    let operation = { $set: { hasNewResults: false } };
    collection.updateOne(query, operation, function (err,result) {
        if (err) { throw err; }
        res.render('results', { username: req.session.username });
        });
    }


async function home(req, res) {
    if (!req.session.rpsr_user_id) { return res.redirect('welcome'); }
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user_id) };
    collection.findOne(query, async function (err, result) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
        res.render('home', { user: result, username: result.screenname });
        });
    }


async function logMessage(message,req)
    {
    let db = await getDb();
    let collection = db.collection("log");
    if ((req) && (req.session.username))
        name = req.session.username;
    else
        name = "unknown player";
    let record = { user: name,
                   timestamp: Date.now(),
                   message: message };
    collection.insertOne(record);
    if (logToConsole)
        console.log(message);
    }


async function makeDefense(req,res) {
    if (!req.session.rpsr_user_id) { return res.redirect('welcome'); }
    let move = getMove(req.body);
    let username = req.session.username;
    logMessage(`makeDefense ${username} ${move}`,req);
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
                    if (err) { logMessage(err,req); return res.sendStatus(500); }
                    res.redirect('home');
                    });
                }
            else
                {
                res.render('nopoints', { username: req.session.username });
                }
            });
    }

async function makeAttack(req,res)
    {
    if (!req.session.rpsr_user_id) { return res.redirect('welcome'); }
    useActionPoint(req, async function (err, result) {
        if (result.matchedCount > 0)
            findDefense(req, res);
        else
            res.render('nopoints', { username: req.session.username });
        });
    }


async function findDefense(req, res)
    {
    let db = await getDb();
    let collection = db.collection("plays");
    let myID = req.session.rpsr_user_id;
    let otherID = req.body.otherid;
    let query = { playerid: otherID };
    collection.findOneAndDelete(query).then(async function (result) {
        let play = result.value;
        if (play)
            othermove = play.move;
        else
            {
            let autoWinQuery = { player1: myID, player2: otherID };
            let autoWinCount = await db.collection("autoWins").count(autoWinQuery);
            if (autoWinCount == 0)
                {
                othermove = 'lose';
                db.collection("autoWins").insertOne(autoWinQuery);
                }
            else
                return res.render('matchfailed', { username: req.session.username });
            }
        resolveAttack(req, res, othermove);
        }).catch(function (err) { logMessage(err,req); return res.sendStatus(500); });
    }

async function resolveAttack(req, res, othermove)
    {
    let db = await getDb();
    let myID = req.session.rpsr_user_id;
    let otherID = req.body.otherid;
    let mymove = getMove(req.body);
    let username = req.session.username;
    let othername = (await playerByID(otherID)).screenname;
    logMessage(`makeAttack ${username} ${mymove} ${otherID} (${othername})`,req);
    let matchRes = decideWinner(mymove, othermove);
    let resultRecord = { player1: { id: req.session.rpsr_user_id,
                                    name: username,
                                    points: matchRes.mypoints,
                                    viewed: true },
                        player2: { id: otherID,
                                    name: othername,
                                    points: matchRes.otherpoints,
                                    viewed: false },
                        time: Date.now(),
                        result: matchRes.result
                        };
    db.collection("results").insertOne(resultRecord, function (err,result) {
        if (err) { logMessage(err,req); }
        });
    updatePlayerScore(req.session.rpsr_user_id, matchRes.mypoints);
    updatePlayerScore(otherID, matchRes.otherpoints);
    res.render('matchresult', { username: username, user: req.session.rpsr_user_id, mymove: mymove, oppmove: othermove, oppname: othername, matchRes: matchRes });
    }


function decideWinner(mymove, othermove)
    {
    if (othermove == 'lose')
        {
        return { result: 'W', mypoints: 1, otherpoints: 0 };
        }
    else if (othermove == 'win')
        {
        return { result: 'L', mypoints: -1, otherpoints: 1 };
        }
    else if (mymove == othermove)
        {
        return { result: 'T', mypoints: 0, otherpoints: 0 };
        }
    else if (((mymove == 'rock') && (othermove == 'scissors')) ||
             ((mymove == 'paper') && (othermove == 'rock')) ||
             ((mymove == 'scissors') && (othermove == 'paper')))
        {
        return { result: 'W', mypoints: 1, otherpoints: 0 };
        }
    else
        {
        return { result: 'L', mypoints: -1, otherpoints: 1 };
        }
    }


async function updatePlayerScore(playerid, points)
    {
    if (points == 0)
        return;
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(playerid) };
    let operation = { $inc: { score: points } };
    collection.updateOne(query, operation, function (err,res) {
        if (err) { throw err; }
        logMessage(`changed ${playerid} score by ${points}`,null);
        });
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


async function playerByID(id)
    {
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(id) };
    let result = await collection.findOne(query);
    return result;
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

/*
async function scoreboard(req, res) {
    let db = await getDb();
    let collection = db.collection("users");
    return await collection.find().sort({points:-1}).toArray(function (err,result) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
        res.render('scoreboard', { players: result, user: req.session.rpsr_user });
        });
    }
*/


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
    logMessage(`trying to create account ${req.body.yourname}`, req);
    let numExisting = await collection.count(query);
    if (numExisting == 0) {
        let obj = { screenname: req.body.yourname, email: "", password: "x", actionpoints: STARTING_POINTS, score: 0, hasNewResults: true };
        collection.insertOne(obj, function (err,result) {
            if (err) { logMessage(err,req); return res.sendStatus(500); }
            req.session.rpsr_user_id = result.insertedId;
            req.session.username = obj.screenname;
            res.redirect(`home`);
            });
        logMessage(`new account ${req.body.yourname}`, req);
        }
    else {
        res.redirect(`/newaccounterror`);
        }
    }


function loginError(req, res) {
    logMessage('loginError', req);
    res.render('loginerror', { username: "" });
    }


function newAccountError(req, res) {
    logMessage('newAccountError', req);
    res.render('newaccounterror', { username: "" });
    }


function logout(req, res) {
    logMessage('logout', req);
    req.session.destroy(function (err) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
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
router.get('/logout', logout);
router.get('/loginerror', loginError);
router.post('/newaccount', newAccount);
router.get('/newaccounterror', newAccountError);

module.exports = router;
