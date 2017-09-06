const cfenv = require("cfenv");
const ibmiotf = require("ibmiotf");
const uuid = require("uuid");

const neededServices = [
    "iotf-service",
    "cloudantNoSQLDB"
];


module.exports = class DependencyFactory {
    /**
     * @returns {AppEnv}
     */
    static getEnvironment() {
        if (typeof DependencyFactory.env === "undefined") {
            let isRunningLocally = true;

            let fallback = {};
            try {
                let fallbackData = require("./vcap.json");
                fallback = {
                    vcap: {
                        services: fallbackData
                    }
                };
            } catch (e) {
                console.log("Could not find fallback VCAP_SERVICES file. Seem to be running on CloudFoundry.");
                isRunningLocally = false;
            }

            let appEnv = cfenv.getAppEnv(fallback);

            let missingServices = [];

            neededServices.forEach((service) => {
                if (typeof appEnv.services[service] === "undefined") {
                    missingServices.push(service);
                }
            });

            if (missingServices.length > 0) {
                let exception = "Following services could not be found: " + missingServices.join(", ");
                if (isRunningLocally === true) {
                    exception += "\nYou seem to be running locally. Are you sure that all services are properly configured in your vcap.json file?";
                }

                throw exception;
            }

            DependencyFactory.env = appEnv;
        }

        return DependencyFactory.env;
    }

    /**
     * @returns {Object}
     */
    static getCredentials(name) {
        let env = DependencyFactory.getEnvironment();
        return env.services[name][0].credentials;
    }



    /**
     * @returns {ApplicationClient}
     */
    static getIotClient() {
        let credentials = DependencyFactory.getCredentials("iotf-service");
        return new ibmiotf.IotfApplication({
            "org": credentials.org,
            "id": uuid.v4(),
            "domain": "internetofthings.ibmcloud.com",
            "auth-key": credentials.apiKey,
            "auth-token": credentials.apiToken,
        });
    }

    /**
     * @param {string} deviceId
     * @param {string} deviceType
     * @param {string} deviceToken
     * @returns DeviceClient
     */
    static getDeviceClient(deviceId, deviceType, deviceToken) {
        let credentials = DependencyFactory.getCredentials("iotf-service");

        return new ibmiotf.IotfDevice({
            "org": credentials.org,
            "id": deviceId,
            "domain": "internetofthings.ibmcloud.com",
            "type": deviceType,
            "auth-method": "token",
            "auth-token": deviceToken,
        });
    }


};
