const fs = require('fs');
const promisify = require('util').promisify;
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const request = promisify(require('request'));
const extend = require('util')._extend;

const settingsFileName = 'settings.json';

async function main(){
  let cmd = process.argv[2];
  if (cmd === 'auth') {
    let settings = await getSettings();
    await loadAuth(settings);
  }
  else if (cmd === 'list') {
    let l = await openStackRequest('/servers/detail');
    console.log(JSON.stringify(l.servers[0]))
    let map = mapArrayByValue(l.servers, 'hostId');
  }
  else if (cmd === 'flavors') {
    let l = await openStackRequest('/flavors/detail');
    console.log(JSON.stringify(l))
    // mapArrayByValue(l.flavors, 'name');
  }
  else if (cmd === 'cloud') {
    let s = await openStackRequest('/servers/detail');
    let f = await openStackRequest('/flavors/detail');
    let srv = mapArrayByValue(s.servers, 'OS-EXT-SRV-ATTR:hypervisor_hostname' /*'hostId'*/);
    let flv = mapArrayByValue(f.flavors, 'id');
    printCloud(srv, flv);
  }
  else if (cmd === 'cloud-json') {
    let s = await openStackRequest('/servers/detail');
    let srvs = mapArrayByValue(s.servers, 'name');
    let res = mapCloudResult(srvs, 'OS-EXT-SRV-ATTR:hypervisor_hostname');
    console.log(JSON.stringify(res));
  }
  else {
    console.log('node cmd <...>\n')
  }
}
main();

// formating output
// ------------------------------------------------------
function printCloud(srv, flv) {
  for (let s in srv) {
    let mem = 0;
    let cpu = 0;
    let disk = 0;
    console.log(s, srv[s].length);
    for (let elm of srv[s]) {
      let f = flv[elm.flavor.id][0];
      console.log(elm.name, f.vcpus, f.ram, f.disk, f.name);
      mem += f.ram;
      cpu += f.vcpus;
      disk += f.disk;
    }
    console.log(`Total RAM:${mem}, CPU:${cpu}, DISK:${disk}`);
    console.log();
  }
}

function printMapArray(map, field) {
  for (let m in map) {
    console.log(m, map[m].length);
    console.log(map[m].map(s => s[field]).join('\n'), '\n');
  }
}

function mapCloudResult(map, field) {
  let res = {};
  for (let m in map) {
    res[m] = map[m][0][field]
    // console.log(m, map[m][0]['OS-EXT-SRV-ATTR:hypervisor_hostname']);
    // console.log(map[m].map(s => s.name).join('\n'), '\n');
  }
  return res;
}

function mapArrayByValue(list, key){
  let map = {};
  for (let e of list) {
    map[e[key]] = map[e[key]] || [];
    map[e[key]].push(e);
  }
  return map;
}

// openstack api connection
// -----------------------------------------------------
async function getSettings() {
  let file = await readFile(settingsFileName);
  let settings = JSON.parse(file);
  if (!(settings && settings.auth && settings.auth.data && settings.auth.data.token)) {
    settings = await loadAuth(settings);
  }
  return settings;
}

async function openStackRequest(path) {
  try {
    let settings = await getSettings();
    let url = await getComputeURL(settings);
    let r = await requestWithAuth(`${url}${path}`);
    return JSON.parse(r.body);
  } catch(e) {
    console.log('openStackRequest err:', e);
  }
}

async function getComputeURL(settings) {
  return settings.auth.data.token.catalog
    .filter(c =>  c.type === "compute")[0]
    .endpoints.filter(e => e.interface === 'public')[0]
    .url;
}

async function loadAuth(settings) {
  try {
    let opts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        "auth": {
          "identity": {
            "methods": ["password"],
            "password": {
              "user": {
                "name": `${settings.credentials.username}`,
                "domain": { "id": "default" },
                "password": `${settings.credentials.password}`
              }
            }
          }
        }
      })
    };

    let r = await request(`${settings.credentials.url}`, opts);
    settings.auth = {
      token: r.headers['x-subject-token'],
      data: JSON.parse(r.body)
    };
    await writeFile(settingsFileName, JSON.stringify(settings, null, 2));
    // console.log('well done');
  } catch(e) {
    console.log('err', e);
  }
  return settings;
}

async function requestWithAuth(url, opts) {
  let settings = await getSettings();
  if (!opts) {
    opts = {};
  }

  opts.headers = extend({
    'X-Auth-Token': settings.auth.token,
    'Content-Type': 'application/json'
  }, opts.headers);

  let r = await request(url, opts);
  // console.log('requestWithAuth1', r.statusCode, settings.auth.token);
  if (r.statusCode === 401) {
    settings = await loadAuth(settings);
    opts.headers['X-Auth-Token'] = settings.auth.token
    r = await request(url, opts);
    // console.log('requestWithAuth2', r.statusCode, settings.auth.token);
  }
  return r;
}
