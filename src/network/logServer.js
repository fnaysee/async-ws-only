async function log(errObject) {
    var formdata = new FormData();
    console.log("2222", errObject)
    formdata.append("error", JSON.stringify(errObject));
    // formdata.append("token", token);

    var requestOptions = {
        method: 'POST',
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Basic " + btoa("async" + ":" + "JHaSD#df435ds73dd")
        },
        body: JSON.stringify({
            "sdkLog": errObject,
            // "token": token
        })
    };

    const error = await fetch("https://talkotp-d.fanapsoft.ir/api/oauth2/otp/log", requestOptions)
        .then(response => response.text())
        .then(result => console.log(result))
        .catch(error => console.log('logServer', error));

    return error;
}

export {log};