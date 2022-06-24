require('dotenv').config()

const express = require('express')
const app = express()
const fs = require('fs');
app.use(express.json())
const bot = require('./telegramBot');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var compression = require('compression');

// Preusmeritev na HTTPS na Heroku
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.header('x-forwarded-proto') !== 'https')
            res.redirect(`https://${req.header('host')}${req.url}`);
        else
            next();
    });
}


// Odprava varnostnih pomanjkljivosti
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.header('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(compression({
    level: 6,
    threshold: 10 * 1000,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    }
}))


//Cross-Domain Misconfiguration
var URI = 'http://localhost:4200';
if (process.env.NODE_ENV === 'production') {
    URI = 'https://marty-hb.herokuapp.com'
} else if (process.env.NODE_ENV === 'docker') {
    URI = 'http://localhost:3000';
}

app.use('/api', (req, res, next) => {
    //res.header('Access-Control-Allow-Origin', 'http://localhost:4200'); //should solve CORS error? (put heroku link later)
    res.header('Access-Control-Allow-Origin', URI);
    res.header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE");
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});


const mongoose = require('mongoose');

const dbURI = process.env.MONGODB_CLOUD_URI

mongoose.connect(dbURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

mongoose.connection.on('connected', () => {
    console.log(`Mongoose is connected to ${dbURI}.`);
});

mongoose.connection.on('error', error => {
    console.log('Mongoose error on connection: ', error);
});

mongoose.connection.on('disconnected', () => {
    console.log('Mongoose is not connected.');
});

const pravilnaZaustavitev = (message, povratniKlic) => {
    mongoose.connection.close(() => {
        console.log(`Mongoose closed the connection with '${message}'`);
        povratniKlic();
    });
};

// Ponovni zagon nodemon
process.once('SIGUSR2', () => {
    pravilnaZaustavitev('nodemon restart', () => {
        process.kill(process.pid, 'SIGUSR2');
    });
});

// Izhod iz aplikacije
process.on('SIGINT', () => {
    pravilnaZaustavitev('exit from application', () => {
        process.exit(0);
    });
});

// Izhod iz aplikacije na Heroku
process.on('SIGTERM', () => {
    pravilnaZaustavitev('exit from application on Heroku', () => {
        process.exit(0);
    });
});

const Message = mongoose.model('Message', new mongoose.Schema({
    message_text: {
        type: String,
        unique: false,
        required: true
    },
    is_good_morning: {
        type: Boolean,
        unique: false,
        required: true

    }
}));

const Image = mongoose.model('Image', new mongoose.Schema({
    image_content: {
        type: Buffer,
        unique: false,
        required: true
    }
}));

const User = mongoose.model('User', new mongoose.Schema({
    chat_id: {
        type: String,
        unique: true,
        required: true
    }
}));


// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404));
});

// Obvladovanje napak zaradi avtentikacije
app.use((err, req, res, next) => {
    if (err.name == "UnauthorizedError") {
        res.status(401).json({
            "message": err.name + ": " + err.message
        });
    }
});

// error handler
app.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});



var appiParams = {
    server: 'http://localhost:' + (process.env.PORT || 3000)
};
if (process.env.NODE_ENV === 'production') {
    appiParams.server = 'https://marty-hb.herokuapp.com/';
}
const axios = require('axios').create({
    baseURL: appiParams.server,
    timeout: 5000,
    maxContentLength: 100000000,
    maxBodyLength: 1000000000
});

const notAuthenticatedMessage = "Nisi autoriziran";

function send_message(chatId, is_good_morning_message = false) {

    check_authentication(chatId, function (is_authenticated) {
        if (is_authenticated) {
            Message.find({ is_good_morning: is_good_morning_message }, function (error, messages) {

                if (error) {
                    bot.sendMessage(chatId, "Mistake on API side when searching.");
                } else {
                    var message = messages[Math.floor(Math.random() * messages.length)];
                    bot.sendMessage(chatId, message.message_text);

                    Image.find({}, function (error, images) {

                        if (error) {
                            bot.sendMessage(chatId, "Mistake on API side when searching.");
                        } else {
                            var image = images[Math.floor(Math.random() * images.length)];
                            bot.sendPhoto(chatId, image.image_content);
                        }
                    });
                }
            });
        } else {
            bot.sendMessage(chatId, notAuthenticatedMessage);
        }
    });
}

function check_authentication(chatId, callback) {

    User.find({ chat_id: chatId }, function (error, image) {

        if (error) {
            bot.sendMessage(chatId, "Mistake on API side when searching.");
        } else {
            callback(image.length > 0);
        }
    });
}

bot.onText(/\/love/, (msg, match) => {
    const chatId = msg.from.id;

    check_authentication(chatId, function (is_authenticated) {
        if (is_authenticated) {
            send_message(chatId);
        } else {
            bot.sendMessage(chatId, notAuthenticatedMessage);
        }
    });
});

bot.onText(/\/info/, (msg, match) => {
    const chatId = msg.from.id;
    check_authentication(chatId, function (is_authenticated) {
        if (is_authenticated) {
            bot.sendMessage(chatId, process.env.INFO_MESSAGE);

        } else {
            bot.sendMessage(chatId, notAuthenticatedMessage);
        }

    });
});


bot.onText(/\/password/, (msg, match) => {
    const chatId = msg.from.id;
    check_authentication(chatId, function (is_authenticated) {
        if (is_authenticated) {
            bot.sendMessage(chatId, "Uporabnik je že autoriziran.");
        } else {
            bot.sendMessage(chatId, "Prosim pošlji geslo kot odgovor na to sporočilo.").then(function (res) {
                bot.onReplyToMessage(res.chat.id, res.message_id, function (message) {
                    if (message.text == process.env.PASSWORD) {

                        const new_image = new User();
                        new_image.chat_id = chatId;

                        new_image.save(error => {
                            if (error) {
                                bot.sendMessage(chatId, error);
                            } else {
                                bot.sendMessage(chatId, "Sedaj si autoriziran");
                            }
                        });
                    } else {
                        bot.sendMessage(chatId, "Napačno geslo, prosim poskusi znova.");
                    }
                })
            });
        }
    });
});

bot.onText(/\/add/, (msg, match) => {
    const chatId = msg.from.id;
    check_authentication(chatId, function (is_authenticated) {
        if (!is_authenticated) {
            bot.sendMessage(chatId, notAuthenticatedMessage);
        } else {
            bot.sendMessage(chatId, "Pošlji novo sliko kot odgovor na to sporočilo.").then(function (res) {

                check_authentication(chatId, function (is_authenticated) {
                    if (!is_authenticated) {
                        bot.sendMessage(chatId, notAuthenticatedMessage);
                    } else {
                        bot.onReplyToMessage(res.chat.id, res.message_id, function (message) {

                            check_authentication(chatId, function (is_authenticated) {
                                if (!is_authenticated) {
                                    bot.sendMessage(chatId, notAuthenticatedMessage);
                                } else {
                                    if (message.photo) {

                                        imageId = message.photo[2].file_id;
                                        bot.getFile(imageId).then((res) => {


                                            bot.downloadFile(res.file_id, "./images/").then((res) => {

                                                const imageData = {
                                                    image_content: fs.readFileSync(res),
                                                }
                                                const image = new Image(imageData);

                                                image.save()
                                                    .then(() => bot.sendMessage(chatId, "Slika je bila uspešno dodana."))
                                                    .catch((err) => bot.sendMessage(chatId, "Slika ni bila dodana."));

                                            });
                                        });
                                    } else {
                                        bot.sendMessage(chatId, "Prosim pošlji eno sliko. Poskusi znova /add.");
                                    }
                                }
                            });
                        });
                    }
                });
            });
        }
    });
});


function send_GM_messages() {
    for (var i = 0; i < authenticated_users.length; i++) {
        send_message(authenticated_users[i], true);
    }
}

var now = new Date();
var millisTill10 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0, 0) - now;
if (millisTill10 < 0) {
    millisTill10 += 86400000; // it's after 10am, try 10am tomorrow.
}

setTimeout(function () { send_GM_messages() }, millisTill10);

console.log(process.env.PORT);
app.listen(process.env.PORT, () => console.log('server started'))