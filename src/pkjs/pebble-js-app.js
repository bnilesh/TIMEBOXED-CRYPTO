/*globals Pebble*/
/*jshint node: true*/
'use strict';

var currentVersion = "4.2";

var OPEN_WEATHER = 0;
var WUNDERGROUND = 1;
var YAHOO = 2;
var FORECAST = 3;

Pebble.addEventListener("ready",
    function(e) {
        console.log("Pebble Ready!");
    }
);

Pebble.addEventListener('appmessage',
    function(e) {
        console.log('AppMessage received!');
        if (e.payload.KEY_HASUPDATE) {
            console.log('Checking for updates...');
            checkForUpdates();
        } else {
            console.log('Fetching weather info...');
            var weatherKey = localStorage.weatherKey;
            var provider = weatherKey ? 1 : 0;
            if (localStorage.weatherProvider) {
                provider = parseInt(localStorage.weatherProvider, 10);
                switch (provider) {
                    case WUNDERGROUND:
                        weatherKey = localStorage.weatherKey;
                        break;
                    case FORECAST:
                        weatherKey = localStorage.forecastKey;
                        break;
                    default:
                        weatherKey = '';
                }
                console.log(weatherKey);
            }
            getWeather(provider, weatherKey, parse(localStorage.useCelsius.toLowerCase()), localStorage.overrideLocation);
        }
    }
);

Pebble.addEventListener('showConfiguration', function(e) {
    var url = 'http://www.lbento.space/pebble-apps/timeboxed/config/?';
    //url = 'http://www.timeboxed.watch/pebble-apps/timeboxed/config/?nonce=' + new Date().getTime() + '&';
    Pebble.openURL(url +
        'v=' + currentVersion +
        '&p=' + Pebble.getActiveWatchInfo().platform +
        '&l=' + Pebble.getActiveWatchInfo().language);
});

Pebble.addEventListener('webviewclosed', function(e) {
    if (!e.response) {
        return;
    }
    var configData = JSON.parse(decodeURIComponent(e.response));
    console.log(JSON.stringify(configData));

    var dict = {};

    for (var item in configData) {
        var key = 'KEY_' + item.toUpperCase();
        var value = configData[item];
        if (String(value).indexOf('0x') !== -1) {
            value = parseInt(value, 16);
        }
        if (String(value).indexOf('|') !== -1) {
            var newValue = value.split('|')[1].split(':')[0];
            dict[key + 'CODE'] = value.split('|')[0];
            dict[key + 'MINUTES'] = parseInt(value.split('|')[1].split(':')[1], 10);
            value = parseInt(newValue, 10);
        }
        if (key === 'KEY_FONTTYPE' || key === 'KEY_DATEFORMAT' || key === 'KEY_LOCALE' ||
                key === 'KEY_TEXTALIGN' || key === 'KEY_WEATHERPROVIDER' || key.indexOf('SLOT') !== -1 ||
                key === 'KEY_SPEEDUNIT' || key === 'KEY_DATESEPARATOR' || key === 'KEY_TAPTIME' ||
                key === 'KEY_HEARTHIGH' || key === 'KEY_HEARTLOW') {
            value = parseInt(value, 10);
        }
        if(key === 'KEY_WEATHERTIME'){
            value = parseInt(value, 10)/5; //reduce interval delays from (10,15,30) to (2, 3, 6)
        }
        dict[key] = value;
    }

    localStorage.weatherEnabled = dict.KEY_ENABLEWEATHER;
    localStorage.useCelsius = dict.KEY_USECELSIUS;
    localStorage.weatherKey = dict.KEY_WEATHERKEY;
    localStorage.overrideLocation = dict.KEY_OVERRIDELOCATION;
    localStorage.weatherProvider = dict.KEY_WEATHERPROVIDER;
    localStorage.forecastKey = dict.KEY_FORECASTKEY;

    delete dict.KEY_WEATHERKEY;
    delete dict.KEY_WEATHERPROVIDER;
    delete dict.KEY_OVERRIDELOCATION;
    delete dict.KEY_FORECASTKEY;
    delete dict.KEY_MASTERKEYEMAIL;
    delete dict.KEY_MASTERKEYPIN;

    if (Pebble.getActiveWatchInfo().platform === 'aplite') {
        Object.keys(dict).filter(function(value) {
            return (
                value.indexOf('WRIST') !== -1 || value.indexOf('TAP') !== -1 ||
                value.indexOf('SLEEP') !== -1 || value.indexOf('HEART') !== -1 ||
                value.indexOf('DEEP') !== -1 || value.indexOf('ACTIVE') !== -1 ||
                value.indexOf('_CAL') !== -1 || value.indexOf('STEPS') !== -1 ||
                value.indexOf('DIST') !== -1 || typeof dict[value] == 'undefined'
            );
        }).map(function(value) {
            delete dict[value];
        });
    }

    console.log('sending');
    Pebble.sendAppMessage(dict, function() {
	console.log('Send config successful: ' + JSON.stringify(dict));
    }, function(data, e) {
	console.log('Send failed! ' + JSON.stringify(dict) + ' --> ' + JSON.stringify(data));
    });
});

function parse(type) {
    return typeof type == 'string' ? JSON.parse(type) : type;
}

function locationSuccess(pos, provider, weatherKey, useCelsius, overrideLocation) {
    console.log("Retrieving weather info");

    switch (provider) {
        case OPEN_WEATHER:
            fetchOpenWeatherMapData(pos, useCelsius, overrideLocation);
            break;
        case WUNDERGROUND:
            fetchWeatherUndergroundData(pos, weatherKey, useCelsius, overrideLocation);
            break;
        case YAHOO:
            fetchYahooData(pos, useCelsius, overrideLocation);
            break;
        case FORECAST:
            fetchForecastApiData(pos, weatherKey, useCelsius, overrideLocation);
    }
}

function executeYahooQuery(pos, useCelsius, woeid, overrideLocation) {
    var url = 'https://query.yahooapis.com/v1/public/yql?format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&q=';
    var woeidQuery = '';
    if (overrideLocation) {
        woeidQuery = 'select woeid from geo.places(1) where text="' + overrideLocation + '"';
    } else {
        woeidQuery = '' + woeid;
    }

    if (woeidQuery) {
        var query = 'select * from weather.forecast where woeid in (' + woeidQuery + ')';
        url += encodeURIComponent(query);
        console.log(url);

        xhrRequest(url, 'GET', function(responseText) {
            try {
                var sunrise, sunset;
                var resp = JSON.parse(responseText);
                var now = new Date();
                var day = now.getDate();
                var dayUTC = now.getUTCDate();

                var resultIndex = 0;
                var res = resp.query.results.channel;
                var results = res.item;
                var wind = res.wind;
                console.log(JSON.stringify(results.forecast[resultIndex]));
                var temp = Math.round(useCelsius ? fahrenheitToCelsius(results.condition.temp) : results.condition.temp);
                var min = Math.round(useCelsius ? fahrenheitToCelsius(results.forecast[resultIndex].low) : results.forecast[resultIndex].low);
                var max = Math.round(useCelsius ? fahrenheitToCelsius(results.forecast[resultIndex].high) : results.forecast[resultIndex].high);
                var condition = y_iconToId[parseInt(results.condition.code, 10)];
                console.log(results.condition.code);
                var feels = Math.round(useCelsius ? fahrenheitToCelsius(parseInt(wind.chill, 10)) : wind.chill);
                var speed = Math.round(wind.speed);
                var direction = Math.round(wind.direction);

                try {
                    sunrise = formatYahooTime(res.astronomy.sunrise);
                    sunset = formatYahooTime(res.astronomy.sunset);
                    console.log('sunrise: ' + sunrise);
                    console.log('sunset: ' + sunset);
                } catch (ex) {
                    console.log('error retrieving sunrise/sunset');
                    sunrise = 0;
                    sunset = 0;
                }

                if (typeof(condition) === 'undefined') {
                    condition = 0;
                }

                sendData(temp, max, min, condition, feels, speed, direction, sunrise, sunset);
            } catch (ex) {
                console.log(ex);
                console.log('Yahoo weather failed, falling back to open weather');
                fetchOpenWeatherMapData(pos, useCelsius, overrideLocation);
            }
        });
    } else {
        console.log('No woeid found, falling back to open weather');
        fetchOpenWeatherMapData(pos, useCelsius, overrideLocation);
    }
}

function formatYahooTime(time) {
    var setTime = time.split(' ')[0].split(':');
    var hours = parseInt(setTime[0], 10);
    var minutes = parseInt(setTime[1], 10);

    if (time.split(' ')[1] === 'pm') {
        hours += 12;
    }

    var newTime = new Date();
    newTime.setHours(hours);
    newTime.setMinutes(minutes);

    return parseInt(newTime.getTime() / 1000, 10);
}

function fetchYahooData(pos, useCelsius, overrideLocation) {
    if (!overrideLocation) {
        getWoeidAndExecuteQuery(pos, useCelsius);
    } else {
        executeYahooQuery(pos, useCelsius, '', overrideLocation);
    }

}

function fahrenheitToCelsius(temp) {
    return (temp - 32)/1.8;
}

function getWoeidAndExecuteQuery(pos, useCelsius) {
    var truncLat = pos.coords.latitude.toFixed(4);
    var truncLng = pos.coords.longitude.toFixed(4);
    var latLng = truncLat + ',' + truncLng;

    if (localStorage[latLng]) {
        console.log('Got woeid from storage. ' + latLng + ': ' + localStorage[latLng]);
        executeYahooQuery(pos, useCelsius, localStorage[latLng]);
        return;
    }

    var url = 'http://gws2.maps.yahoo.com/findlocation?pf=1&locale=en_US&offset=15&flags=J&q=' + truncLat + '%2c' + truncLng + '&gflags=R&start=0&count=100';

    console.log(url);
    xhrRequest(url, 'GET', function(responseText) {
        try {
            var resp = JSON.parse(responseText);
            if (resp.ResultSet.Error === 0) {
                var woeid = resp.ResultSet.Results[0].woeid;
                console.log('Got woeid from API. ' + latLng + ': ' + woeid);
                localStorage[latLng] = woeid;
                executeYahooQuery(pos, useCelsius, woeid);
            } else {
                console.log('woeid query failed: ' + resp.ResultSet.Error);
                executeYahooQuery(pos, useCelsius, '');
            }
        } catch (ex) {
            console.log(ex.stack);
            console.log('woeid query failed');
            executeYahooQuery(pos, useCelsius, '');
        }
    });
}

function fetchWeatherUndergroundData(pos, weatherKey, useCelsius, overrideLocation) {
    var url = 'http://api.wunderground.com/api/' + weatherKey + '/conditions/forecast/astronomy/q/';
    if (!overrideLocation) {
        url += pos.coords.latitude + ',' + pos.coords.longitude + '.json';
    } else {
        url += encodeURIComponent(overrideLocation) + '.json';
    }

    console.log(url);

    xhrRequest(url, 'GET', function(responseText) {
        try {
            var sunrise, sunset;
            var resp = JSON.parse(responseText);
            var results = resp.current_observation;
            var temp = Math.round((useCelsius ? results.temp_c : results.temp_f));
            var highTemp = resp.forecast.simpleforecast.forecastday[0].high;
            var lowTemp = resp.forecast.simpleforecast.forecastday[0].low;
            var max = Math.round((useCelsius ? highTemp.celsius : highTemp.fahrenheit));
            var min = Math.round((useCelsius ? lowTemp.celsius : lowTemp.fahrenheit));
            var icon = results.icon_url.match(/\/([^.\/]*)\.gif/)[1];
            var condition = wu_iconToId[icon];
            var feels = Math.round((useCelsius ? results.feelslike_c : results.feelslike_f));
            var speed = Math.round(results.wind_mph);
            var direction = results.wind_degrees;

            try {
                sunrise = formatWeatherUndergroundDate(resp.sun_phase.sunrise.hour, resp.sun_phase.sunrise.minute);
                sunset = formatWeatherUndergroundDate(resp.sun_phase.sunset.hour, resp.sun_phase.sunset.minute);
                console.log('sunrise: ' + sunrise);
                console.log('sunset: ' + sunset);
            } catch (ex) {
                console.log('error retrieving sunrise/sunset ' + ex);
                sunrise = 0;
                sunset = 0;
            }

            if (typeof(condition) === 'undefined') {
                condition = 0;
            }

            sendData(temp, max, min, condition, feels, speed, direction, sunrise, sunset);

        } catch(ex) {
            console.log(ex.stack);
            console.log('Falling back to Yahoo');
            fetchYahooData(pos, useCelsius, overrideLocation);
        }
    });
}

function formatWeatherUndergroundDate(hours, minutes) {
    var time = new Date();
    time.setHours(parseInt(hours, 10));
    time.setMinutes(parseInt(minutes, 10));

    return parseInt(time.getTime() / 1000, 10);
}

function fetchForecastApiData(pos, weatherKey, useCelsius, overrideLocation) {
    if (overrideLocation) {
        findLocationAndExecuteQuery(weatherKey, useCelsius, overrideLocation);
    } else {
        executeForecastQuery(pos, weatherKey, useCelsius);
    }
}

function findLocationAndExecuteQuery(weatherKey, useCelsius, overrideLocation) {
    if (localStorage[overrideLocation]) {
        console.log('Got coords for ' + overrideLocation + ' from storage: ' + localStorage[overrideLocation]);
        executeForecastQuery(JSON.parse(localStorage[overrideLocation]), weatherKey, useCelsius, overrideLocation);
        return;
    }

    var pos;
    var url = 'https://query.yahooapis.com/v1/public/yql?format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&q=';
    var query = 'select centroid from geo.places(1) where text="' + overrideLocation + '"';
    url += encodeURIComponent(query);
    console.log('Retrieving location data for Dark Sky');
    console.log(url);
    xhrRequest(url, 'GET', function(responseText) {
        try {
            var resp = JSON.parse(responseText);
            var res = resp.query.results.place.centroid;
            pos = { coords: {
                latitude: parseFloat(res.latitude),
                longitude: parseFloat(res.longitude),
            }};

            localStorage[overrideLocation] = JSON.stringify(pos);

            executeForecastQuery(pos, weatherKey, useCelsius, overrideLocation);
        } catch (ex) {
            console.log(ex.stack);
            console.log('Falling back to Yahoo');
            fetchYahooData(pos, useCelsius, overrideLocation);
        }
    });


}

function executeForecastQuery(pos, weatherKey, useCelsius, overrideLocation) {
    console.log(JSON.stringify(pos));
    var truncLat = pos.coords.latitude.toFixed(4);
    var truncLng = pos.coords.longitude.toFixed(4);
    var url = 'https://api.darksky.net/forecast/' + weatherKey + '/' + truncLat  + ',' + truncLng;

    console.log('Retrieving weather data from Dark Sky');
    console.log(url);
    xhrRequest(url, 'GET', function(responseText) {
        try {
            var sunrise, sunset;
            var resp = JSON.parse(responseText);
            var temp = Math.round((useCelsius ? fahrenheitToCelsius(resp.currently.temperature) : resp.currently.temperature));
            var max = Math.round((useCelsius ? fahrenheitToCelsius(resp.daily.data[0].temperatureMax) : resp.daily.data[0].temperatureMax));
            var min = Math.round((useCelsius ? fahrenheitToCelsius(resp.daily.data[0].temperatureMin) : resp.daily.data[0].temperatureMin));
            var icon = resp.currently.icon;
            var condition = f_iconToId[icon];
            var feels = Math.round((useCelsius ? fahrenheitToCelsius(resp.currently.apparentTemperature) : resp.currently.apparentTemperature));
            var speed = Math.round(resp.currently.windSpeed);
            var direction = Math.round(resp.currently.windBearing);

            try {
                sunrise = formatTimestamp(parseInt(resp.daily.data[0].sunriseTime, 10));
                sunset = formatTimestamp(parseInt(resp.daily.data[0].sunsetTime, 10));
                console.log('sunrise: ' + sunrise);
                console.log('sunset: ' + sunset);
            } catch (ex) {
                console.log('error retrieving sunrise/sunset');
                sunrise = 0;
                sunset = 0;
            }

            if (typeof(condition) === 'undefined') {
                condition = 0;
            }

            sendData(temp, max, min, condition, feels, speed, direction, sunrise, sunset);
        } catch (ex) {
            console.log(ex.stack);
            console.log('Falling back to Yahoo');
            fetchYahooData(pos, useCelsius, overrideLocation);
        }

    });
}

function formatTimestamp(timestamp) {
    return parseInt(timestamp, 10);
}

function fetchOpenWeatherMapData(pos, useCelsius, overrideLocation) {
    var url = 'http://api.openweathermap.org/data/2.5/weather?appid=e617a20aa44b64245ff669964d9bfacc';
    var urlForecast = 'http://api.openweathermap.org/data/2.5/forecast/daily?appid=e617a20aa44b64245ff669964d9bfacc&format=json&cnt=3';

    if (!overrideLocation) {
        url += '&lat=' + pos.coords.latitude + '&lon=' + pos.coords.longitude;
        urlForecast += '&lat=' + pos.coords.latitude + '&lon=' + pos.coords.longitude;
    } else {
        url += '&q=' + encodeURIComponent(overrideLocation);
        urlForecast += '&q=' + encodeURIComponent(overrideLocation);
    }

    console.log(url);
    console.log(urlForecast);

    xhrRequest(url, 'GET', function(responseText) {
        try {
            console.log('Retrieving current weather from OpenWeatherMap');
            var sunrise, sunset;
            var resp = JSON.parse(responseText);
            var temp = useCelsius ? kelvinToCelsius(resp.main.temp) : kelvinToFahrenheit(resp.main.temp);
            var condition = ow_iconToId[resp.weather[0].icon];
            var feels = temp;
            var speed = Math.round(resp.wind.speed * 2.23694);
            var direction = parseInt(resp.wind.deg, 10) || 0;
            console.log(responseText);
            var day = new Date(resp.dt * 1000);

            try {
                sunrise = formatTimestamp(parseInt(resp.sys.sunrise, 10));
                sunset = formatTimestamp(parseInt(resp.sys.sunset, 10));
                console.log('sunrise: ' + sunrise);
                console.log('sunset: ' + sunset);
            } catch (ex) {
                console.log('error retrieving sunrise/sunset');
                sunrise = 0;
                sunset = 0;
            }

            if (typeof(condition) === 'undefined') {
                condition = 0;
            }

            xhrRequest(urlForecast, 'GET', function(forecastRespText) {
                try {
                    console.log('Retrieving forecast data from OpenWeatherMap');
                    var fResp = JSON.parse(forecastRespText);

                    var max = useCelsius ? kelvinToCelsius(fResp.list[0].temp.max) : kelvinToFahrenheit(fResp.list[0].temp.max);
                    var min = useCelsius ? kelvinToCelsius(fResp.list[0].temp.min) : kelvinToFahrenheit(fResp.list[0].temp.min);

                    for (var fIndex in fResp.list) {
                        var fDay = new Date(fResp.list[fIndex].dt * 1000);
                        if (day.getUTCDate() === fDay.getUTCDate()) {
                            console.log(JSON.stringify(fResp.list[fIndex]));
                            max = useCelsius ? kelvinToCelsius(fResp.list[fIndex].temp.max) : kelvinToFahrenheit(fResp.list[fIndex].temp.max);
                            min = useCelsius ? kelvinToCelsius(fResp.list[fIndex].temp.min) : kelvinToFahrenheit(fResp.list[fIndex].temp.min);
                        }
                    }

                    sendData(temp, max, min, condition, feels, speed, direction, sunrise, sunset);
                } catch (ex) {
                    console.log('Failure requesting forecast data from OpenWeatherMap');
                    console.log(ex.stack);
                }
            });

        } catch (ex) {
            console.log('Failure requesting current weather from OpenWeatherMap');
            console.log(ex.stack);
        }
    });
}

function checkForUpdates() {
    var url = 'http://pblweb.com/api/v1/version/1354d7dc-b9e5-420d-9edf-533ee2fd4520.json?current=' + currentVersion;
    xhrRequest(url, 'GET', function(responseText) {
        try {
            var resp = JSON.parse(responseText);
            var updateAvailable = resp.newer;
            console.log('Current version: ' + currentVersion + ', Latest version: ' + resp.version);
            sendUpdateData(updateAvailable);
        } catch (ex) {
            console.log(ex);
            sendUpdateData(false);
        }
    });
}

function sendUpdateData(updateAvailable) {
    console.log(updateAvailable ? 'Update available!' : 'No updates.');
    Pebble.sendAppMessage({'KEY_HASUPDATE': updateAvailable},
        function(e) {
            console.log('Sent update data to Pebble successfully!');
        },
        function(e) {
            console.log('Error sending update data to Pebble!');
        }
    );
}

function kelvinToCelsius(temp) {
    return Math.round(temp - 273.15);
}

function kelvinToFahrenheit(temp) {
    return Math.round(temp * 1.8 - 459.67);
}

function sendData(temp, max, min, condition, feels, speed, direction, sunrise, sunset) {
  var url_btc = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
	var url_eth = "https://api.coinbase.com/v2/prices/ETH-USD/spot";
  var url_ltc = "https://api.coinbase.com/v2/prices/LTC-USD/spot";
  
	xhrRequest(url_btc, "GET", function(text_btc) {
    console.log('BTC '+text_btc);
		var obj_btc = JSON.parse(text_btc);
		var btc = Number(obj_btc.data.amount).toFixed(0);
    
    xhrRequest(url_eth, "GET", function(text_eth) {
      console.log('ETH '+text_eth);
      var obj_eth = JSON.parse(text_eth);
		  var eth = Number(obj_eth.data.amount).toFixed(0);

      xhrRequest(url_ltc, "GET", function(text_ltc) {
      console.log('LTC '+text_ltc);
        var obj_ltc = JSON.parse(text_ltc);
  		  var ltc = Number(obj_ltc.data.amount).toFixed(2);
  
        var data = {
            'KEY_TEMP': temp || 0,
            'KEY_MAX': max || 0,
            'KEY_MIN': min || 0,
            'KEY_WEATHER': condition || 0,
            'KEY_FEELS': feels || 0,
            'KEY_SPEED': speed || 0,
            'KEY_DIRECTION': direction || 0,
            'KEY_SUNRISE': sunrise || 0,
            'KEY_SUNSET': sunset || 0,
            'KEY_BTC':  parseInt(btc, 10) || 0,
            'KEY_ETH': parseInt(eth, 10) || 0,
            'KEY_LTC': ltc || "00.00"       
        };
        
        console.log(JSON.stringify(data));
        Pebble.sendAppMessage(data,
            function(e) {
                console.log('Weather info sent to Pebble successfully!');
            },
            function(e) {
                console.log('Error sending weather info to Pebble!');
            }
        );
      });
    });
  });
}

function locationError(err) {
    console.log('Error requesting location!');
}

function getWeather(provider, weatherKey, useCelsius, overrideLocation) {
    console.log('Requesting weather: ' + provider + ', ' + weatherKey + ', ' + useCelsius + ', ' + overrideLocation);
    provider = provider || 0;
    weatherKey = weatherKey || '';
    useCelsius = useCelsius || false;
    overrideLocation = overrideLocation || '';
    if (overrideLocation) {
        locationSuccess(null, provider, weatherKey, useCelsius, overrideLocation);
    } else {
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                locationSuccess(pos, provider, weatherKey, useCelsius, overrideLocation);
            },
            locationError,
            {timeout: 15000, maximumAge: 60000}
        );
    }
}


var xhrRequest = function (url, type, callback) {
    var xhr = new XMLHttpRequest();
    xhr.onload = function () {
        callback(this.responseText);
    };

    try {
        xhr.open(type, url);
        xhr.send();
    } catch (ex) {
        console.log(ex);
        sendError();
    }
};

var sendError = function() {
    Pebble.sendAppMessage({'KEY_ERROR': true},
        function(e) {
            console.log('Sent empty state to Pebble successfully!');
        },
        function(e) {
            console.log('Error sending empty state to Pebble!');
        }
    );
};

var wu_iconToId = {
    'unknown': 0,
    'clear': 1,
    'sunny': 2,
    'partlycloudy': 3,
    'mostlycloudy': 4,
    'mostlysunny': 5,
    'partlysunny': 6,
    'cloudy': 7,
    'rain': 8,
    'snow': 9,
    'tstorms': 10,
    'sleat': 11,
    'flurries': 12,
    'hazy': 13,
    'chancetstorms': 14,
    'chancesnow': 15,
    'chancesleat': 16,
    'chancerain': 17,
    'chanceflurries': 18,
    'nt_unknown': 19,
    'nt_clear': 20,
    'nt_sunny': 21,
    'nt_partlycloudy': 22,
    'nt_mostlycloudy': 23,
    'nt_mostlysunny': 24,
    'nt_partlysunny': 25,
    'nt_cloudy': 26,
    'nt_rain': 27,
    'nt_snow': 28,
    'nt_tstorms': 29,
    'nt_sleat': 30,
    'nt_flurries': 31,
    'nt_hazy': 32,
    'nt_chancetstorms': 33,
    'nt_chancesnow': 34,
    'nt_chancesleat': 35,
    'nt_chancerain': 36,
    'nt_chanceflurries': 37,
    'fog': 38,
    'nt_fog': 39
};

var f_iconToId = {
    'clear-day': 1,
    'clear-night': 20,
    'rain': 8,
    'snow': 9,
    'sleet': 11,
    'wind': 44,
    'fog': 38,
    'cloudy': 7,
    'partly-cloudy-day': 6,
    'partly-cloudy-night': 25
};

var ow_iconToId = {
    '01d': 1,
    '02d': 3,
    '03d': 7,
    '04d': 7,
    '09d': 8,
    '10d': 8,
    '13d': 9,
    '11d': 10,
    '50d': 13,
    '01n': 20,
    '02n': 22,
    '03n': 26,
    '04n': 26,
    '09n': 27,
    '10n': 27,
    '13n': 28,
    '11n': 29,
    '50n': 32,
};

var y_iconToId = {
    '3200': 0,
    '32': 1,
    '34': 1,
    '30': 5,
    '28': 4,
    '26': 7,
    '44': 7,
    '10': 8,
    '11': 8,
    '12': 8,
    '40': 8,
    '13': 9,
    '14': 9,
    '15': 9,
    '16': 9,
    '41': 9,
    '42': 9,
    '43': 9,
    '46': 9,
    '1': 10,
    '3': 10,
    '4': 10,
    '37': 10,
    '38': 10,
    '39': 10,
    '45': 10,
    '47': 10,
    '5': 11,
    '6': 11,
    '7': 11,
    '8': 40,
    '9': 40,
    '18': 11,
    '17': 41,
    '35': 41,
    '21': 13,
    '19': 13,
    '31': 20,
    '33': 20,
    '27': 23,
    '29': 24,
    '20': 38,
    '25': 42,
    '36': 43,
    '23': 44,
    '24': 44,
    '0': 45,
    '2': 46
};
