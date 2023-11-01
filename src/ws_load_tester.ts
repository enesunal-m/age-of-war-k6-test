import http from 'k6/http';
import { WebSocket } from 'k6/experimental/websockets';
import { setTimeout, setInterval, clearInterval } from 'k6/experimental/timers';
import { Trend } from 'k6/metrics';
import { check } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

export let options = {
    vus: 50, // 50 virtual users
    duration: '10s', // run the test for 2 minutes
};

const workerCount = 10;

let localUrl = 'localhost:8080';
let prodUrl = '167.172.105.111';

let hostUrl = "";

let attackTimestamps: number[] = [];
let latencies: number[] = [];
let latencyTrend = new Trend('attack_latency');

let openConnections = workerCount;

export default function () {

    hostUrl = prodUrl;

    for (let i = 0; i < workerCount; i++) {
        startWSWorker();
    }
}

function startWSWorker() {

    const url = "ws://" + hostUrl + "/game/ws";
    let gameId: string = "";

    const ws = new WebSocket(url);

    let token = "eyJhbGciOiJIUzI1NiJ9.eyJleHBpcmF0aW9uIjoiN2QiLCJ1c2VySWQiOiJiYjRiNjI3Yi1iMmRlLTRhY2QtOGZjOC1kNWYwNDFiMTkyNmUifQ.4D7KWqTxjE5mSi4B-8tEktJgqdMUevq-n2MGFmvzxJU";

    if (!token) {
        console.error('Failed to obtain token');
        return;
    }

    ws.onopen = function () {
        ws.send(JSON.stringify({
            action: "startGame",
            token: token,
            data: {}
        }));

        ws.onmessage = function (e) {
            const responseData = JSON.parse(e?.data as string);

            // Capture the gameId once the game has started
            if (responseData.action === 'gameStarted') {
                gameId = responseData.data.gameId;

                // Spawn two units after capturing the gameId
                ws.send(JSON.stringify({
                    action: "spawnUnit",
                    token: token,
                    data: {
                        gameId: gameId,
                        id: "unit1",
                        type: "warrior",
                        side: "left",
                        health: 10000
                    }
                }));

                ws.send(JSON.stringify({
                    action: "spawnUnit",
                    token: token,
                    data: {
                        gameId: gameId,
                        id: "unit2",
                        type: "warrior",
                        side: "right",
                        health: 10000
                    }
                }));
            } else if (responseData.action === 'unitAttacked') {
                recordAttackLatency();
            }
        };

        const intervalId = setInterval(() => {

            if (gameId != "") {
                //console.log('Sending attack message...');
                attackTimestamps.push(new Date().getTime());
                ws.send(JSON.stringify({
                    action: "unitAttack",
                    token: token,
                    data: {
                        attackerId: "unit1",
                        targetId: "unit2",
                        damage: 10,
                        gameId: gameId
                    }
                }));

                /*                 attackTimestamps.push(new Date().getTime());
                                // unit2 attacks unit1
                                ws.send(JSON.stringify({
                                    action: "unitAttack",
                                    token: token,
                                    data: {
                                        attackerId: "unit2",
                                        targetId: "unit1",
                                        damage: 10,
                                        gameId: gameId
                                    }
                                })); */
            }

        }, 1000); // say something every 2-8 seconds

        setTimeout(function () {
            clearInterval(intervalId);
        }, 60 * 1000);

    };

    ws.onclose = function () {
        openConnections--;
    };

    ws.onerror = function (e) {
        if (e?.error != "websocket: close sent") {
            console.log('An unexpected error occurred: ', e?.error);
        }
    };
}

export function handleSummary(data: any) {
    console.log('Finished executing performance tests');

    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }), // Show the text summary to stdout...
        'summary.txt': textSummary(data, { indent: ' ' }),
        'summary.json': JSON.stringify(data, null, 2),
    };
}

function recordAttackLatency() {
    let now = new Date().getTime();
    let sentTime = attackTimestamps.shift();
    if (sentTime) {
        let latency = now - sentTime;
        latencies.push(latency);
        latencyTrend.add(latency);
    }
}

function getToken() {
    let res = http.post('http://' + hostUrl + '/api/auth/login', { username: 'menes', password: '12345' });

    check(res, {
        'login succeeded': (resp) => resp.status === 200,
    });

    // Extract the token from the Set-Cookie header or the response body
    // This step depends on how your backend sets the token
    let tokenMatch = res.headers['Set-Cookie'].match(/access_token=([^;]+)/);
    if (!tokenMatch) return null;

    let token = tokenMatch[1];
    return token;
}
