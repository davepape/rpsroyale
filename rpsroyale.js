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



async function rootPage(req, res) {
    if (req.session.rpsr_user_id) { return res.redirect('/game'); }
    return res.sendStatus(404);
    }


async function index(req, res) {
    if (req.session.rpsr_user_id)
        game(req, res);
    else
        welcomePage(req, res);
    }

async function welcomePage(req, res) {
    res.render('welcome', { user: null } );
    }

async function aboutPage(req, res) {
    let user = await playerByID(req.session.rpsr_user_id);
    res.render('about', { user: user });
    }

async function attackPage(req, res) {
    if (!req.session.rpsr_user_id) { return res.redirect('/welcome'); }
    let user = await playerByID(req.session.rpsr_user_id);
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: { $ne: ObjectID(req.session.rpsr_user_id) } };
    collection.find(query).toArray(async function (err, result) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
        let others = [];
        for (let i=0; i < result.length; i++)
            {
            if (!(result[i].screenname in others))
                others.push(result[i]);
            }
        res.render('attack', { user: user, otherplayers: others, insults: insultLists(10) });
        });
    }

async function defendPage(req, res) {
    if (!req.session.rpsr_user_id) { return res.redirect('/welcome'); }
    let user = await playerByID(req.session.rpsr_user_id);
    let db = await getDb();
    let query = { playerid: req.session.rpsr_user_id };
    db.collection('plays').count(query, async function (err,result) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
        res.render('defend', { user: user, numDefenses: result, insults: insultLists(10) });
        });
    }

async function scoreboardPage(req, res) {
    let user = await playerByID(req.session.rpsr_user_id);
    let db = await getDb();
    let collection = db.collection("users");
    collection.find({}).sort({score:-1, screenname: 1}).toArray(async function (err, result) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
        for (let i=0; i < result.length; i++)
            {
            if ((user) && (result[i]._id == user._id))
                result[i].css = 'table-active';
            else
                result[i].css = '';
            }
        res.render('scoreboard', { user: user, scores: result });
        });
    }

async function settingsPage(req, res) {
    if (!req.session.rpsr_user_id) { return res.redirect('/welcome'); }
    let user = await playerByID(req.session.rpsr_user_id);
    res.render('settings', { user: user });
    }

async function resultsPage(req, res) {
    if (!req.session.rpsr_user_id) { return res.redirect('/welcome'); }
    let user = await playerByID(req.session.rpsr_user_id);
    let db = await getDb();
    let query = { _id: ObjectID(req.session.rpsr_user_id) };
    let operation = { $set: { hasNewResults: false } };
    db.collection("users").updateOne(query, operation);
    user.hasNewResults = false;
    query = { $or: [{'player1.id': req.session.rpsr_user_id}, {'player2.id': req.session.rpsr_user_id}] };
    db.collection("results").find(query).sort({time: -1}).toArray(async function (err,result) {
        if (err) { throw err; }
        let mergedResults = [];
        for (let i=0; i < result.length; i++)
            {
            let r = result[i];
            let highlight = '';
            let winlose = 'beat';
            let otherName = '';
            if (r.player1.id == req.session.rpsr_user_id)
                {
                if (!r.player1.viewed) highlight = 'table-active';
                if (r.result == 'L') winlose = 'lost to';
                else if (r.result == 'T') winlose = 'tied';
                otherName = r.player2.name;
                }
            else
                {
                if (!r.player2.viewed) highlight = 'table-active';
                if (r.result == 'W') winlose = 'lost to';
                else if (r.result == 'T') winlose = 'tied';
                otherName = r.player1.name;
                }
            let taunt = '';
            if (winlose == 'lost to')
                taunt = r.taunt;
            mergedResults.push({highlight: highlight, winlose: winlose, other: otherName, time: printableTime(r.time), taunt: taunt});
            }
        db.collection("results").updateMany({'player2.id': req.session.rpsr_user_id},{$set: { 'player2.viewed': true }});
        res.render('results', { user: user, results: mergedResults });
        });
    }


async function game(req, res) {
    if (!req.session.rpsr_user_id) { return res.redirect('/welcome'); }
    let user = await playerByID(req.session.rpsr_user_id);
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user_id) };
    collection.findOne(query, async function (err, result) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
        res.render('game', { user: result, username: result.screenname });
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
    if (!req.session.rpsr_user_id) { return res.redirect('/welcome'); }
    let user = await playerByID(req.session.rpsr_user_id);
    let move = getMove(req.body);
    let username = user.screenname;
    let taunt = `${tauntPrefix()} you ${req.body.taunt1} ${req.body.taunt2} ${req.body.taunt3}!`;
    logMessage(`makeDefense ${username} ${move}`,req);
    useActionPoint(req, async function (err, result) {
            if (result.matchedCount > 0)
                {
                let db = await getDb();
                let collection = db.collection("plays");
                let play = { playername: username,
                            playerid: req.session.rpsr_user_id,
                            move: move,
                            taunt: taunt,
                            timestamp: Date.now()
                            };
                collection.insertOne(play, function (err,result) {
                    if (err) { logMessage(err,req); return res.sendStatus(500); }
                    db.collection("autoWins").deleteMany({player2: req.session.rpsr_user_id});
                    res.redirect('/game');
                    });
                }
            else
                {
                res.render('nopoints', { user: user });
                }
            });
    }

async function makeAttack(req,res)
    {
    if (!req.session.rpsr_user_id) { return res.redirect('/welcome'); }
    useActionPoint(req, async function (err, result) {
        if (result.matchedCount > 0)
            findDefense(req, res);
        else
            {
            let user = await playerByID(req.session.rpsr_user_id);
            res.render('nopoints', { user: user });
            }
        });
    }


async function findDefense(req, res)
    {
    if (checkForBotDefender(req, res))
        return;
    let db = await getDb();
    let myID = req.session.rpsr_user_id;
    let otherID = req.body.opponent;
    let othertaunt = '';
    let query = { playerid: otherID };
    db.collection("plays").findOneAndDelete(query).then(async function (result) {
        let play = result.value;
        if (play)
            {
            othermove = play.move;
            othertaunt = play.taunt;
            }
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
                {
                let user = await playerByID(req.session.rpsr_user_id);
                return res.render('matchfailed', { user: user });
                }
            }
        resolveAttack(req, res, otherID, othermove, othertaunt);
        }).catch(function (err) { logMessage(err,req); return res.sendStatus(500); });
    }

const winningDefense = { 'rock': 'paper', 'paper': 'scissors', 'scissors': 'rock', 'cheat': 'win' };

async function checkForBotDefender(req, res)
    {
    let db = await getDb();
    let otherID = req.body.opponent;
    let otherPlayer = await playerByID(otherID);
    let othertaunt = randomTaunt();
    if (otherPlayer.screenname == "Rock Bot")
        {
        let othermove = 'rock';
        resolveAttack(req, res, otherID, othermove, othertaunt);
        return true;
        }
    else if (otherPlayer.screenname == "Random Bot")
        {
        let othermove = choose(['rock', 'paper', 'scissors']);
        resolveAttack(req, res, otherID, othermove, othertaunt);
        return true;
        }
    else if (otherPlayer.screenname == "I-Always-Win Bot")
        {
        let othermove = winningDefense[validateMove(req.body.attack)];
        resolveAttack(req, res, otherID, othermove, othertaunt);
        return true;
        }
    return false;
    }

async function resolveAttack(req, res, otherID, othermove, othertaunt)
    {
    let user = await playerByID(req.session.rpsr_user_id);
    let db = await getDb();
    let myID = req.session.rpsr_user_id;
    let mymove = validateMove(req.body.attack);
    let username = user.screenname;
    let othername = (await playerByID(otherID)).screenname;
    let mytaunt = `${tauntPrefix()} you ${req.body.taunt1} ${req.body.taunt2} ${req.body.taunt3}!`;
    logMessage(`makeAttack ${username} ${mymove} ${otherID} (${othername})`,req);
    let matchRes = decideWinner(mymove, othermove, mytaunt, othertaunt);
    let resultRecord = { player1: { id: req.session.rpsr_user_id,
                                    name: username,
                                    points: matchRes.mypoints,
                                    viewed: true },
                        player2: { id: otherID,
                                    name: othername,
                                    points: matchRes.otherpoints,
                                    viewed: false },
                        time: Date.now(),
                        result: matchRes.result,
                        taunt: matchRes.taunt
                        };
    db.collection("results").insertOne(resultRecord, function (err,result) {
        if (err) { logMessage(err,req); }
        });
    updatePlayerScore(req.session.rpsr_user_id, matchRes.mypoints, false);
    updatePlayerScore(otherID, matchRes.otherpoints, true);
    user = await playerByID(req.session.rpsr_user_id);
    res.render('matchresult', { user: user, mymove: mymove, oppmove: othermove, oppname: othername, matchRes: matchRes });
    }


function decideWinner(mymove, othermove, mytaunt, othertaunt)
    {
    if (othermove == 'lose')
        {
        return { result: 'W', mypoints: 1, otherpoints: 0, taunt: mytaunt };
        }
    else if (othermove == 'win')
        {
        return { result: 'L', mypoints: -1, otherpoints: 1, taunt: othertaunt };
        }
    else if (mymove == othermove)
        {
        return { result: 'T', mypoints: 0, otherpoints: 0, taunt: '' };
        }
    else if (((mymove == 'rock') && (othermove == 'scissors')) ||
             ((mymove == 'paper') && (othermove == 'rock')) ||
             ((mymove == 'scissors') && (othermove == 'paper')))
        {
        return { result: 'W', mypoints: 1, otherpoints: 0, taunt: mytaunt };
        }
    else
        {
        return { result: 'L', mypoints: -1, otherpoints: 1, taunt: othertaunt };
        }
    }


function getMove(body)
    {
    if (body.rock) return 'rock';
    if (body.paper) return 'paper';
    if (body.scissors) return 'scissors';
    return 'cheat';
    }


function validateMove(move)
    {
    if ((move == 'rock') || (move == 'paper') || (move == 'scissors'))
        return move;
    return 'cheat';
    }


async function updatePlayerScore(playerid, points, newResultFlag)
    {
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(playerid) };
    let operation = { $inc: { score: points } };
    if (newResultFlag)
        operation = { $inc: { score: points }, $set: { hasNewResults: true } };
    collection.updateOne(query, operation, function (err,res) {
        if (err) { throw err; }
        logMessage(`changed ${playerid} score by ${points}`,null);
        });
    }


async function useActionPoint(req, callback)
    {
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(req.session.rpsr_user_id), actionpoints: { $gte: 1 } };
    let operation = { $inc: { actionpoints: -1 } };
    collection.updateOne(query, operation, callback);
    }


async function addActionPoints(userid, points)
    {
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(userid) };
    let operation = { $inc: { actionpoints: points } };
    collection.updateOne(query, operation);
    }


async function playerByID(id)
    {
    let db = await getDb();
    let collection = db.collection("users");
    let query = { _id: ObjectID(id) };
    let result = await collection.findOne(query);
    return result;
    }


function printableTime(t) {
    let d = new Date(t);
    return d.toLocaleDateString('en-us', { month: "short", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", timeZone: 'America/New_York'});
    }


function oppositeResult(r) {
    if (r == 'W')
        return 'L';
    else if (r == 'L')
        return 'W';
    else
        return r;
    }


async function scanQR(req,res)
    {
    if (!req.session.rpsr_user_id) { return res.redirect('/welcome'); }
    let siteNum = req.params.num;
    let user = await playerByID(req.session.rpsr_user_id);
    let db = await getDb();
    let collection = db.collection('qrscans');
    let query = { playerid: req.session.rpsr_user_id, siteNum: siteNum };
    collection.findOne(query, async function (err,result) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
        let okToAdd = !result;
        if (result)
            {
            let lastVisit = new Date(result.timestamp);
            lastVisit.setHours(lastVisit.getHours() + 1);
            let now = new Date();
            if (now >= lastVisit)
                okToAdd = true;
            }
        if (okToAdd)
            {
            let points = 5;
            addActionPoints(req.session.rpsr_user_id, points);
            user.actionpoints += points;
            let newval = { $set: { timestamp: Date.now() }};
            collection.updateOne(query, newval, { upsert: true });
            logMessage(`scanned target ${siteNum}`, req);
            res.render('scannedqr', { user: user, points: points });
            }
        else
            {
            logMessage(`tried to scan target ${siteNum} too soon`, req);
            res.render('scanqrfailed', { user: user });
            }
        });
    }



let insult1 = ['artless', 'bawdy', 'beslubbering', 'bootless', 'churlish', 'cockered', 'clouted', 'craven', 'currish', 'dankish', 'dissembling', 'droning', 'errant', 'fawning', 'fobbing', 'froward', 'frothy', 'gleeking', 'goatish', 'gorbellied', 'impertinent', 'infectious', 'jarring', 'loggerheaded', 'lumpish', 'mammering', 'mangled', 'mewling', 'paunchy', 'pribbling', 'puking', 'puny', 'qualling', 'rank', 'reeky', 'roguish', 'ruttish', 'saucy', 'spleeny', 'spongy', 'surly', 'tottering', 'unmuzzled', 'vain', 'venomed', 'villainous', 'warped', 'wayward', 'weedy', 'yeasty'];
let insult2 = ['base-court', 'bat-fowling', 'beef-witted', 'beetle-headed', 'boil-brained', 'clapper-clawed', 'clay-brained', 'common-kissing', 'crook-pated', 'dismal-dreaming', 'dizzy-eyed', 'doghearted', 'dread-bolted', 'earth-vexing', 'elf-skinned', 'fat-kidneyed', 'fen-sucked', 'flap-mouthed', 'fly-bitten', 'folly-fallen', 'fool-born', 'full-gorged', 'guts-griping', 'half-faced', 'hasty-witted', 'hedge-born', 'hell-hated', 'idle-headed', 'ill-breeding', 'ill-nurtured', 'knotty-pated', 'milk-livered', 'motley-minded', 'onion-eyed', 'plume-plucked', 'pottle-deep', 'pox-marked', 'reeling-ripe', 'rough-hewn', 'rude-growing', 'rump-fed', 'shard-borne', 'sheep-biting', 'spur-galled', 'swag-bellied', 'tardy-gaited', 'tickle-brained', 'toad-spotted', 'unchin-snouted', 'weather-bitten'];
let insult3 = ['apple-john', 'baggage', 'barnacle', 'bladder', 'boar-pig', 'bugbear', 'bum-bailey', 'canker-blossom', 'clack-dish', 'clotpole', 'coxcomb', 'codpiece', 'death-token', 'dewberry', 'flap-dragon', 'flax-wench', 'flirt-gill', 'foot-licker', 'fustilarian', 'giglet', 'gudgeon', 'haggard', 'harpy', 'hedge-pig', 'horn-beast', 'hugger-mugger', 'joithead', 'lewdster', 'lout', 'maggot-pie', 'malt-worm', 'mammet', 'measle', 'minnow', 'miscreant', 'moldwarp', 'mumble-news', 'nut-hook', 'pigeon-egg', 'pignut', 'puttock', 'pumpion', 'ratsbane', 'scut', 'skainsmate', 'strumpet', 'varlot', 'vassal', 'whey-face', 'wagtail'];

function shuffle(list,numSwaps)
    {
    for (let i=0; i < numSwaps; i++)
        {
        let a = Math.floor(Math.random()*Math.min(list.length,numSwaps));
        let b = Math.floor(Math.random()*list.length);
        let tmp = list[a];
        list[a] = list[b];
        list[b] = tmp;
        }
    }

function insultLists(count)
    {
    shuffle(insult1, 10);
    shuffle(insult2, 10);
    shuffle(insult3, 10);
    return [ insult1.slice(0,count), insult2.slice(0,count), insult3.slice(0,count) ];
    }

let tauntPrefixes = [ 'I won,', 'You lost,', 'I beat you,', 'Take that,', 'Ha!', '"Good game",' ];

function tauntPrefix()
    {
    return choose(tauntPrefixes);
    }

function randomTaunt()
    {
    let t = insultLists(1);
    return `${tauntPrefix()} you ${t[0][0]} ${t[1][0]} ${t[2][0]}!`;
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
                req.session.rpsr_user_id = result._id;
                res.redirect(`/game`);
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

async function newAccount(req, res)
    {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { return res.render('error', { user: null, errors: errors.array() }); }
    let db = await getDb();
    let collection = db.collection("users");
    let query = { screenname: new RegExp(`^${req.body.yourname}$`,'i') };
    logMessage(`trying to create account ${req.body.yourname}`, req);
    let numExisting = await collection.count(query);
    if (numExisting == 0) {
        let obj = { screenname: req.body.yourname, email: "", password: "x", actionpoints: STARTING_POINTS, score: 0, hasNewResults: false };
        collection.insertOne(obj, function (err,result) {
            if (err) { logMessage(err,req); return res.sendStatus(500); }
            req.session.rpsr_user_id = result.insertedId;
            req.session.username = obj.screenname;
            res.redirect(`/game`);
            });
        logMessage(`new account ${req.body.yourname}`, req);
        }
    else {
        res.redirect(`/newaccounterror`);
        }
    }


async function randomName(req, res)
    {
    let name = await generateName();
    if (!name)
        return res.redirect('/newaccounterror');
    let db = await getDb();
    let collection = db.collection("users");
    logMessage(`trying to create random-named account ${name}`, req);
    let obj = { screenname: name, email: "", password: "x", actionpoints: STARTING_POINTS, score: 0, hasNewResults: false };
    collection.insertOne(obj, function (err,result) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
        req.session.rpsr_user_id = result.insertedId;
        req.session.username = obj.screenname;
        res.redirect(`/game`);
        });
    logMessage(`new account ${name}`, req);
    }


async function generateName()
    {
    let first = [ 'Random', 'Anonymous', 'Some', 'Other' ];
    let second = [ 'Player', 'User', 'Person', 'Entity', 'Buffalonian' ];
    let db = await getDb();
    let collection = db.collection("users");
    for (let i=0; i < 100; i++)
        {
        let name = choose(first) + ' ' + choose(second) + ' ' + Math.floor(Math.random()*100);
        let query = { screenname: new RegExp(`^${name}$`,'i') };
        let numExisting = await collection.count(query);
        if (numExisting == 0)
            return name;
        }
    return null;
    }

function choose(l)
    {
    return l[Math.floor(Math.random()*l.length)];
    }

function loginError(req, res)
    {
    logMessage('loginError', req);
    res.render('loginerror', { user: null });
    }


function newAccountError(req, res)
    {
    logMessage('newAccountError', req);
    res.render('newaccounterror', { user: null });
    }


function logout(req, res)
    {
    logMessage('logout', req);
    req.session.destroy(function (err) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
        res.redirect(`.`);
        });
    }


async function resetGame(req, res)
    {
    if (req.params.password != process.env.RPSR_ADMIN_PASSWORD)
        {
        logMessage('resetGame - wrong password', req);
        return res.redirect('/');
        }
    logMessage('resetting game', req);
    logMessage('===========================================================', req);
    let db = await getDb();
    db.collection('autoWins').deleteMany({});
    db.collection('plays').deleteMany({});
    db.collection('results').deleteMany({});
    db.collection('users').updateMany({}, { $set: { actionpoints: STARTING_POINTS, score: 0, hasNewResults: false } });
    res.redirect('/game');
    }


async function log(req, res)
    {
    if (req.params.password != process.env.RPSR_ADMIN_PASSWORD)
        {
        logMessage('log - wrong password', req);
        return res.redirect('/');
        }
    let db = await getDb();
    db.collection('log').find({}).sort({timestamp:-1}).toArray(async function (err,result) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
        for (let i=0; i < result.length; i++)
            {
            result[i].time = printableTime(result[i].timestamp);
            }
        res.render('log', { log: result });
        });
    }

async function monitor(req, res)
    {
    if (req.params.password != process.env.RPSR_ADMIN_PASSWORD)
        {
        logMessage('monitor - wrong password', req);
        return res.redirect('/');
        }
    let db = await getDb();
    db.collection('users').find({}).sort({screenname:1}).toArray(async function (err,result) {
        if (err) { logMessage(err,req); return res.sendStatus(500); }
        res.render('monitor', { users: result });
        });
    }


const express = require('express');
let router = express.Router();

router.get('/', rootPage);
router.get('/rpsr', index);
router.get('/game', game);
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
router.get('/randomname', randomName);
router.get('/scanQR/:num', scanQR);
router.get('/resetgame/:password', resetGame);
router.get('/log/:password', log);
router.get('/monitor/:password', monitor);

module.exports = router;
