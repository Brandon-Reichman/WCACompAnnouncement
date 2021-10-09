var express = require('express');
var app = express();
var bodyParser = require('body-parser');
const { stringify } = require('querystring');
const { isBuffer } = require('util');
const { json } = require('body-parser');
const methodOverride = require('method-override');
var jsonParser = bodyParser.json()
var https = require('https')
var schedule = require('node-schedule')
var nodemailer = require('nodemailer')
var urlencodedParser = bodyParser.urlencoded({ extended: true })
app.use(jsonParser)
app.use(methodOverride('X-HTTP-Method-Override'))

const { MongoClient } = require('mongodb');
const uri = "";
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

var compList
var compByCountry = new Map()
var storedCompCountryList = new Map()

app.use(express.static(__dirname))

schedule.scheduleJob('0 0 * * *', () => { //Schedule for midnight Server Time (8pm Eastern Time)
    fetchCompList()
})

app.post('/add_user', urlencodedParser, function(req, res) {

    var regex = new RegExp('/^.+@.+\..+$/')

    if(regex.test(req.body.email)) {
        var body = {
            email:req.body.email,
            country:req.body.country
        }
    
        client.connect(err => {
            var collection = client.db("UsersDB").collection("EmailCollection")
            collection.insertOne(body)
    
            res.sendFile(__dirname + "/" + "user_added.html")
        })
    }
})

app.post('/remove_user', urlencodedParser, function(req, res) {
    client.connect(err => {
        if(err) {
            throw err
        }

        var collection = client.db("UsersDB").collection("EmailCollection")
        var query = {
            email: req.body.email
        }

        collection.deleteMany(query, function(err, collect) {
            if (err) {
                throw err
            }

            res.sendFile(__dirname + "/user_removed.html")
            client.close()
        })
    })
})

function fetchCompList() {
    https.get("https://www.worldcubeassociation.org/api/v0/competitions", (resp) => {
        let data = ''

        resp.on('data', (chunk => {
            data += chunk
        }))

        resp.on('end', () => {
            storeCurrentCompList(JSON.parse(data))
        })
    }).on('error', (err) => {
        console.log("Error: " + err.message)
    })
}

function storeCurrentCompList(comp_list) {
    if(compList != null) {
        let result = compList.length == comp_list.length &&
            comp_list.every(function(element) {
                return compList.includes(element)
            })

        if (result) {
            return
        }

        compList = compList.filter(function(event) {
           return isFutureComp(event)
        })
    }

    compList = []

    for(var i = 0; i < comp_list.length; i++) {
        compList.push(comp_list[i])
    }

    sortListIntoMap(compList)

    notifyNewComps()
}

function sortListIntoMap(list) {
    list.forEach(element => {
        if (compByCountry.has(element.country_iso2)) {
            var shouldNotAdd = false
            compByCountry.get(element.country_iso2).filter((comp, index, self) => {
                index === self.findIndex((e) => {
                    shouldNotAdd = e.id === element.id
                    return shouldNotAdd
                })
            })
            if(!shouldNotAdd) {
                compByCountry.get(element.country_iso2).push(element)
            }
            
        } else {
            compByCountry.set(element.country_iso2, [])
            compByCountry.get(element.country_iso2).push(element)
        }
    });

    compByCountry.forEach(list => {
        list = list.filter(function(event) {
            return isFutureComp(event)
        })
    })
}

function notifyNewComps() {

    var transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: "cubecompupdates@gmail.com",
            pass: ""
        },
        tls:{ rejectUnauthorized: false}
    })

    client.connect(err => {
        const collection = client.db("UsersDB").collection("EmailCollection");

        collection.find().toArray(function(err, result) {
            if (err) {
                throw err
            }

            for (var i = 0; i < result.length; i++) {        
                if(compByCountry.get(result[i].country) != null) {
                    var compsToNotify = compByCountry.get(result[i].country).filter(x => { 
                        var isCompStored = false
                        if (storedCompCountryList != null) {
                            if(storedCompCountryList.has(x.country_iso2)) {
                                isCompStored = storedCompCountryList.get(x.country_iso2).some(event => event.id === x.id)
                            }
                        }
            
                       return !isCompStored && isFutureComp(x)
                    })
            
                    compsToNotify = compsToNotify.filter(function(comp) {
                        return comp.cancelled_at == null
                    })

                    if (compsToNotify.length == 0) {
                        continue
                    }
            
                    var emailText = "A new WCA competition was just announced for your country. Details for the competition(s) are below.\n\n"
            
                    for (var k = 0; k < compsToNotify.length; k++) {
                        emailText += compsToNotify[k].name + ": " + compsToNotify[k].url + "\n\n"
                    }
                    
                    var mailOptions = {
                        from: 'cubecompupdates@gmail.com',
                        to: result[i].email,
                        subject: "New Competition In Your Country!",
                        text: emailText
                    }
            
                    transporter.sendMail(mailOptions, function(err, info) {
                        if (err) {
                            console.log(err)
                        } else {
                            console.log("Email Sent: " + info.response)
                        }
                    })
                }
            }

            for (const [key, value] of compByCountry.entries()) {
                value.filter(function(event) {
                    return isFutureComp(event)
                })
                storedCompCountryList.set(key, value)
            }

            compByCountry.clear()
        })
      });
}

function isFutureComp(event) {
    var startDate = event.start_date
            var dateArr = startDate.split("-")
            var year = dateArr[0]
            var month = dateArr[1]
            var day = dateArr[2]

            var currentDate = new Date()
            var currentYear = currentDate.getFullYear()
            var currentMonth = currentDate.getMonth() + 1 //Default is 0-11
            var currentDay = currentDate.getDate()

            var isFutureComp = true

            if (year < currentYear) {
                isFutureComp = false
            } else if (month < currentMonth && year <= currentYear) {
                isFutureComp = false
            } else if (day < currentDay && month <= currentMonth && year <= currentYear) {
                isFutureComp = false
            }

            return isFutureComp
}

app.get('/', function (req, res) {
    res.sendFile( __dirname + "/" + "index.html" );
 })

var server = app.listen(8080, function () {
    var host = server.address().address
    var port = server.address().port
    
    console.log("Listening on port %s", host, port)
 })