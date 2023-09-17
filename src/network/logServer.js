async function log(errObject) {
    var formdata = new FormData();
    console.log("logServer: ", errObject)
    formdata.append("error", JSON.stringify(errObject));
    // formdata.append("token", token);

    var formBody = [];
    // for (var property in errObject) {
    //     var encodedKey = encodeURIComponent(property);
    //     var encodedValue = encodeURIComponent(errObject[property]);
    //     formBody.push(encodedKey + "=" + encodedValue);
    // }
        var encodedKey = encodeURIComponent('sdkLog');
        var encodedValue = encodeURIComponent(JSON.stringify(errObject));
    formBody.push(encodedKey + "=" + encodedValue);
    formBody = formBody.join("&");

    var requestOptions = {
        method: 'POST',
        headers: {
            "Content-Type": 'application/x-www-form-urlencoded;charset=UTF-8',
            // "Authorization": "Basic " + btoa("async" + ":" + "JHaSD#df435ds73dd")
        },
        body: formBody
    };

    const error = await fetch("https://talkotp-d.fanapsoft.ir/log/logSdk", requestOptions)
        .then(response => response.text())
        .then(result => console.log(result))
        .catch(error => console.log('logServer', error));

    return error;
}

export {log};