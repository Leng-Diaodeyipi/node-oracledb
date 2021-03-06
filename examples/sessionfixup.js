/* Copyright (c) 2018, 2019, Oracle and/or its affiliates. All rights reserved. */

/******************************************************************************
 *
 * You may not use the identified files except in compliance with the Apache
 * License, Version 2.0 (the "License.")
 *
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * NAME
 *   sessionfixup.js
 *
 * DESCRIPTION
 *   Shows using a pooled connection callback function to efficiently
 *   set the "session state" of pooled connections to the same values
 *   when each connection is first used.
 *
 *   Each connection in a connection pool can retain state (such as
 *   ALTER SESSION values) from when the connection was previously
 *   used.  Using a sessionCallback function for a connection pool
 *   removes the overhead of unnecessarily re-executing ALTER SESSION
 *   commands after each pool.getConnection() call.
 *
 *   Run this script and experiment sending web requests for example
 *   send 20 requests with a concurrency of 4:
 *     ab -n 20 -c 4 http://127.0.0.1:7000/
 *   The function myFixupFunc() will be called just once per connection
 *   in the pool.
 *
 *   This file uses Node 8's async/await syntax but could be rewritten
 *   to use callbacks.
 *
 *   Also see sessiontagging.js
 *
 *****************************************************************************/

const http = require('http');
const oracledb = require('oracledb');
const dbConfig = require('./dbconfig.js');
const httpPort = 7000;

// This function will be invoked internally when each brand new pooled
// connection is first used.  Its callback function 'cb' should be
// invoked only when all desired session state has been set.
// In this example, the requestedTag and actualTag parameters are
// ignored.  They would be valid if connection tagging was being used.
function myFixupFunc(connection, requestedTag, actualTag, cb) {
  console.log('In myFixupFunc()');
  connection.execute(
    `begin
       EXECUTE IMMEDIATE 'ALTER SESSION SET TIME_ZONE = ''UTC''';
       -- Other SQL statements go here if required
       -- Using an anonymous PL/SQL block reduces the number of execute() calls
     end;`,
    cb);
}

async function init() {
  try {
    await oracledb.createPool({
      user: dbConfig.user,
      password: dbConfig.password,
      connectString: dbConfig.connectString,
      sessionCallback: myFixupFunc,
      poolMin: 1,
      poolMax: 4,
      poolIncrement: 1
    });

    // Create HTTP server and listen on port httpPort
    let server = http.createServer();
    server.on('error', (err) => {
      console.log('HTTP server problem: ' + err);
    });
    server.on('request', (request, response) => {
      handleRequest(request, response);
    });
    await server.listen(httpPort);
    console.log("Server running at http://localhost:" + httpPort);
  } catch (err) {
    console.error("init() error: " + err.message);
  }
}

async function handleRequest(request, response) {
  let connection;
  try {
    // Get a connection from the default connection pool
    connection = await oracledb.getConnection();
    let r = await connection.execute('select sysdate from dual');
    console.log(r.rows[0][0]);
  } catch (err) {
    console.error(err.message);
  } finally {
    if (connection) {
      try {
        await connection.close(); // Put the connection back in the pool
      } catch (err) {
        console.error(err);
      }
    }
    response.end();
  }
}

async function closePoolAndExit() {
  console.log("\nTerminating");
  try {
    // Get the pool from the pool cache and close it when no
    // connections are in use, or force it closed after 10 seconds
    let pool = oracledb.getPool();
    await pool.close(10);
    console.log("Pool closed");
    process.exit(0);
  } catch(err) {
    // Ignore getPool() error, which may occur if multiple signals
    // sent and the pool has already been removed from the cache.
    process.exit(0);
  }
}

process
  .on('SIGTERM', closePoolAndExit)
  .on('SIGINT',  closePoolAndExit);

init();
