var assert = require('assert');
var api = require('../');
var fs = require('fs');
var path = require('path');

function normalizeProj4(s) {
  return String(s || '').split(/\s+/).filter(function(t) {
    if (!t || t === '+no_defs' || t === '+type=crs') return false;
    if (t === '+lat_0=0') return false;
    return true;
  }).sort().join(' ');
}

describe('PROJJSON bridge', function() {
  it('projjson_to_proj4 accepts EPSG:4326-style lat/lon axes', function() {
    var obj = {
      type: 'GeographicCRS',
      name: 'WGS 84',
      datum_ensemble: {
        name: 'World Geodetic System 1984 ensemble',
        ellipsoid: {
          name: 'WGS 84',
          semi_major_axis: 6378137,
          inverse_flattening: 298.257223563
        }
      },
      prime_meridian: {name: 'Greenwich', longitude: 0},
      coordinate_system: {
        subtype: 'ellipsoidal',
        axis: [
          {name: 'Geodetic latitude', abbreviation: 'Lat', direction: 'north', unit: 'degree'},
          {name: 'Geodetic longitude', abbreviation: 'Lon', direction: 'east', unit: 'degree'}
        ]
      },
      id: {authority: 'EPSG', code: 4326}
    };
    var proj4 = api.internal.projjson_to_proj4(JSON.stringify(obj));
    assert.equal(normalizeProj4(proj4), normalizeProj4('+proj=longlat +datum=WGS84'));
  });

  it('roundtrips projected definitions through PROJJSON object form', function() {
    var p4 = '+proj=tmerc +lat_0=49 +lon_0=-2 +k_0=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +no_defs';
    var pj = api.internal.projjson_from_proj4(p4, {as_object: true});
    assert.equal(pj.type, 'ProjectedCRS');
    var rt = api.internal.projjson_to_proj4(pj);
    assert.equal(normalizeProj4(rt), normalizeProj4(p4));
  });

  it('preserves towgs84 via BoundCRS transformation', function() {
    var p4 = '+proj=tmerc +lat_0=0 +lon_0=27 +x_0=3500000 +ellps=intl +towgs84=-96.062,-82.428,-121.753,4.801,0.345,-1.376,1.496 +no_defs';
    var pj = api.internal.projjson_from_proj4(p4, {as_object: true});
    assert.equal(pj.type, 'BoundCRS');
    var rt = api.internal.projjson_to_proj4(pj);
    assert.equal(normalizeProj4(rt), normalizeProj4(p4));
  });

  it('converts sample EPSG:4326 PROJJSON fixture', function() {
    var file = path.join(__dirname, 'projjson', 'epsg4326_from_spatialreference.json');
    var obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    var proj4 = api.internal.projjson_to_proj4(obj);
    assert.equal(normalizeProj4(proj4), normalizeProj4('+proj=longlat +datum=WGS84'));
  });

  it('converts sample custom Orthographic PROJJSON fixture', function() {
    var file = path.join(__dirname, 'projjson', 'custom_crs_example.json');
    var obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    var proj4 = api.internal.projjson_to_proj4(obj);
    // Don't over-specify defaults; assert key semantics.
    assert.ok(/\+proj=ortho\b/.test(proj4), proj4);
    assert.ok(/\+lat_0=43\.88\b/.test(proj4), proj4);
    assert.ok(/\+lon_0=-72\.69\b/.test(proj4), proj4);
  });
});

// The output of projjson_from_proj4() has to satisfy the PROJJSON schema, not
// merely round-trip through this library. Each case below was a definition
// that PROJ refused to parse.
describe('PROJJSON schema conformance', function() {

  function fromProj4(str) {
    return api.internal.projjson_from_proj4(str, {as_object: true});
  }

  function eachCrs(obj, cb) {
    cb(obj);
    if (obj.base_crs) eachCrs(obj.base_crs, cb);
    if (obj.source_crs) eachCrs(obj.source_crs, cb);
    if (obj.target_crs) eachCrs(obj.target_crs, cb);
  }

  it('gives the WGS 84 datum ensemble all of its members', function() {
    // PROJ: "ensemble should have at least 2 datums"
    var pj = fromProj4('+proj=longlat +datum=WGS84');
    var members = pj.datum_ensemble.members;
    assert.equal(pj.datum_ensemble.id.code, 6326);
    assert.ok(members.length >= 2, 'expected >= 2 members, got ' + members.length);
    assert.equal(members[0].name, 'World Geodetic System 1984 (Transit)');
    assert.equal(members[members.length - 1].name, 'World Geodetic System 1984 (G2296)');
  });

  it('gives the WGS 84 ensemble all of its members inside a BoundCRS target', function() {
    var pj = fromProj4('+proj=tmerc +lon_0=27 +ellps=intl +towgs84=-96,-82,-121,4.8,0.3,-1.3,1.4');
    assert.equal(pj.type, 'BoundCRS');
    assert.ok(pj.target_crs.datum_ensemble.members.length >= 2);
  });

  it('names an abbreviation for every axis', function() {
    // PROJ: 'Missing "abbreviation" key'
    ['+proj=longlat +datum=WGS84', '+init=EPSG:26915', '+proj=aea +lat_1=29.5 +lat_2=45.5 +lon_0=-96 +datum=NAD83']
      .forEach(function(str) {
        eachCrs(fromProj4(str), function(crs) {
          crs.coordinate_system.axis.forEach(function(axis) {
            assert.ok(axis.name, 'missing axis name in ' + str);
            assert.ok(axis.abbreviation, 'missing axis abbreviation in ' + str);
          });
        });
      });
  });

  it('matches PROJ axis naming for geographic and projected coordinate systems', function() {
    var geog = fromProj4('+proj=longlat +datum=WGS84').coordinate_system.axis;
    assert.deepEqual(geog, [
      {name: 'Geodetic latitude', abbreviation: 'Lat', direction: 'north', unit: 'degree'},
      {name: 'Geodetic longitude', abbreviation: 'Lon', direction: 'east', unit: 'degree'}
    ]);
    var proj = fromProj4('+init=EPSG:26915').coordinate_system.axis;
    assert.deepEqual(proj, [
      {name: 'Easting', abbreviation: 'E', direction: 'east', unit: 'metre'},
      {name: 'Northing', abbreviation: 'N', direction: 'north', unit: 'metre'}
    ]);
  });

  it('gives a ProjectedCRS base_crs its own coordinate_system', function() {
    // PROJ: 'Missing "coordinate_system" key' -- WKT2 omits CS[] from
    // BASEGEOGCRS, but PROJJSON requires it.
    var pj = fromProj4('+init=EPSG:26915');
    assert.equal(pj.type, 'ProjectedCRS');
    assert.equal(pj.base_crs.coordinate_system.subtype, 'ellipsoidal');
    assert.equal(pj.base_crs.coordinate_system.axis.length, 2);
  });

  it('spells the Cartesian coordinate system subtype the way the schema does', function() {
    // PROJ: 'Unhandled value for subtype'
    assert.equal(fromProj4('+init=EPSG:26915').coordinate_system.subtype, 'Cartesian');
    assert.equal(fromProj4('+proj=longlat +datum=WGS84').coordinate_system.subtype, 'ellipsoidal');
  });

  it('emits an exact central meridian for UTM zones', function() {
    // P.lam0 is stored in radians; converting it straight back to degrees
    // gave zone 15 a central meridian of -92.99999999999999.
    [[15, -93], [1, -177], [30, -3], [60, 177]].forEach(function(pair) {
      var pj = fromProj4('+proj=utm +zone=' + pair[0] + ' +datum=WGS84');
      var param = pj.conversion.parameters.filter(function(p) {
        return p.name == 'Longitude of natural origin';
      })[0];
      assert.equal(param.value, pair[1], 'UTM zone ' + pair[0]);
    });
  });
});
