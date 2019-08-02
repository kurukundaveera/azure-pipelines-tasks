import fs = require('fs');
import Q = require('q');
import tl = require('azure-pipelines-task-lib/task');
import path = require('path');
import stripbom = require('strip-bom');

import * as xml2js from 'xml2js';
import * as os from 'os';
import * as fse from 'fs-extra';

import { getPackagingServiceConnections, ServiceConnection, ServiceConnectionAuthType, UsernamePasswordServiceConnection, TokenServiceConnection, PrivateKeyServiceConnection } from "artifacts-common/serviceConnectionUtils";

const accessTokenEnvSetting: string = 'ENV_MAVEN_ACCESS_TOKEN';

export function getInternalFeedsServerElements(input: string) {
    const feeds: string[] = tl.getDelimitedInput(input, ",", false);
    var serverElements: any[] = [];

    if (!feeds || feeds.length === 0)
    {
        return serverElements;
    }

    tl.debug(tl.loc("Info_GeneratingInteralFeeds", feeds.length));
    for (let feed of feeds) {
        serverElements.push({
                id: feed,
                configuration: {
                    httpHeaders: {
                        property: {
                            name: 'Authorization',
                            value: 'Basic ${env.' + accessTokenEnvSetting + '}'
                        }
                    }
                }
            });
    }

    return serverElements;
}

export function getExternalServiceEndpointsServerElements(input: string) {
    var serviceConnections = getPackagingServiceConnections(input, ["REPOSITORYID"]);
    var serverElements: any[] = [];
    if (!serviceConnections || serviceConnections.length === 0)
    {
        return serverElements;
    }

    tl.debug(tl.loc("Info_GeneratingExternalRepositories", serviceConnections.length));
    for(let serviceConnection of serviceConnections) {
        switch (serviceConnection.authType) {
            case (ServiceConnectionAuthType.UsernamePassword):
                const usernamePasswordAuthInfo = serviceConnection as UsernamePasswordServiceConnection;

                serverElements.push({
                    id: serviceConnection.additionalData["REPOSITORYID"],
                    username: usernamePasswordAuthInfo.username,
                    password: usernamePasswordAuthInfo.password,

                });

                tl.debug(`Detected username/password credentials for '${serviceConnection.packageSource.uri}'`);
                break;
            case (ServiceConnectionAuthType.Token):
                const tokenAuthInfo = serviceConnection as TokenServiceConnection;
                serverElements.push({
                    id: serviceConnection.additionalData["REPOSITORYID"],
                    configuration: {
                        httpHeaders: {
                            property: {
                                name: 'Authorization',
                                value: 'Basic ' + tokenAuthInfo.token
                            }
                        }
                    }
                });
                tl.debug(`Detected token credentials for '${serviceConnection.packageSource.uri}'`);
                break;
            case (ServiceConnectionAuthType.PrivateKey):
                const privateKeyAuthInfo = serviceConnection as PrivateKeyServiceConnection;
                serverElements.push({
                    id: serviceConnection.additionalData["REPOSITORYID"],
                    privateKey: privateKeyAuthInfo.privateKey,
                    passphrase: privateKeyAuthInfo.passphrase
                });
                tl.debug(`Detected token credentials for '${serviceConnection.packageSource.uri}'`);
                break;
            default:
                throw Error(tl.loc('Error_InvalidServiceConnection', serviceConnection.packageSource.uri));
        }
    }   

    return serverElements;
}

export function readXmlFileAsJson(filePath: string): Q.Promise<any> {
    return readFile(filePath, 'utf-8')
        .then(convertXmlStringToJson);
}

export function writeJsonAsSettingsFile(filePath: string, jsonContent: any): Q.Promise<void> {
    return writeJsonAsXmlFile(filePath, jsonContent.settings, 'settings');
}

export function mavenSettingsJsonInsertServer (json: any, serverJson:any): any {
    if (!json) {
        json = {};
    }
    if (!json.settings || typeof json.settings === "string") {
        json.settings = {};
    }
    if (!json.settings.$) {
        json.settings.$ = {};
        json.settings.$['xmlns'] = 'http://maven.apache.org/SETTINGS/1.0.0';
        json.settings.$['xmlns:xsi'] = 'http://www.w3.org/2001/XMLSchema-instance';
        json.settings.$['xsi:schemaLocation'] = 'http://maven.apache.org/SETTINGS/1.0.0' + os.EOL + 'https://maven.apache.org/xsd/settings-1.0.0.xsd';
    }
    if (!json.settings.servers) {
        json.settings.servers = {};
    }
    addPropToJson(json.settings.servers, 'server', serverJson);
    return json;
}


function addPropToJson(obj: any, propName:string, value: any): void {
    if (!obj) {
        obj = {};
    }

    if (obj instanceof Array) {
        let propNode = obj.find(o => o[propName]);
        if (propNode) {
            obj = propNode;
        }
    }

    let containsId: (o) => boolean = function(o) {
        if (value && value.id) {
            if (o.id instanceof Array) {
                return o.id.find((v) => {
                    return v === value.id;
                });
            } else {
                return value.id === o.id;
            }
        }
        return false;
    };

    if (propName in obj) {
        if (obj[propName] instanceof Array) {
            let existing = obj[propName].find(containsId);
            if (existing) {
                tl.warning(tl.loc('Warning_FeedEntryAlreadyExists', value.id));
                tl.debug('Entry: ' + value.id);
            } else {
                obj[propName].push(value);
            }
        } else if (typeof obj[propName] !== 'object') {
            obj[propName] = [obj[propName], value];
        } else {
            let prop = {};
            prop[propName] = value;
            obj[propName] = [obj[propName], value];
        }
    } else if (obj instanceof Array) {
        let existing = obj.find(containsId);
        if (existing) {
            tl.warning(tl.loc('Warning_FeedEntryAlreadyExists', value.id));
            tl.debug('Entry: ' + value.id);
        } else {
            let prop = {};
            prop[propName] = value;
            obj.push(prop);
        }
    } else {
        obj[propName] = value;
    }
}


function writeJsonAsXmlFile(filePath: string, jsonContent: any, rootName:string): Q.Promise<void> {
    let builder = new xml2js.Builder({
        pretty: true,
        headless: true,
        rootName: rootName
    });
    let xml = builder.buildObject(jsonContent);
    xml = xml.replace(/&#xD;/g, '');
    return writeFile(filePath, xml);
}

function writeFile(filePath: string, fileContent: string): Q.Promise<void> {
    fse.mkdirpSync(path.dirname(filePath));
    return Q.nfcall<void>(fs.writeFile, filePath, fileContent, { encoding: 'utf-8' });
}

function readFile(filePath: string, encoding: string): Q.Promise<string> {
    return Q.nfcall<string>(fs.readFile, filePath, encoding);
}

async function convertXmlStringToJson(xmlContent: string): Promise<any> {
    return Q.nfcall<any>(xml2js.parseString, stripbom(xmlContent));
}