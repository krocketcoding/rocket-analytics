// Shared DATA fixture — a miniature of the <script id="data"> JSON the
// build embeds. Launches span two years and cover every launch category
// plus each grouping's edge cases: manufacturer abbrev vs full name, a
// suborbital-only rocket, a rocket with no resolvable manufacturer, and
// an orbit-capable rocket that never flew.

function launch(o) {
  return {name: 'Mission', net: '2025-06-15T12:00:00Z', status_id: 1,
          orbit: 'LEO', rocket_id: 1, pad_id: 100, provider_id: 10,
          mission_description: '', ...o};
}

function makeData(overrides = {}) {
  const data = {
    meta: {updated: '2026-01-01T00:00:00Z', truncated: false,
           updates_src: null, offline: false},
    images: ['https://img/0.png', null],
    upcoming: [launch({name: 'Future', net: '2026-06-01T00:00:00Z'})],
    previous: [
      launch({name: 'F9-a', net: '2025-03-10T00:00:00Z'}),
      launch({name: 'F9-b', net: '2025-07-20T00:00:00Z', status_id: 2}),
      launch({name: 'F9-c', net: '2024-04-01T00:00:00Z', orbit: 'SSO'}),
      launch({name: 'SND-1', net: '2024-05-05T00:00:00Z', rocket_id: 2,
              orbit: 'Sub'}),
      launch({name: 'OO-1',  net: '2024-08-08T00:00:00Z', rocket_id: 3}),
      launch({name: 'NM-1',  net: '2024-09-09T00:00:00Z', rocket_id: 6}),
    ],
    rockets: {
      1: {name: 'Falcon 9', manufacturer_id: 10, family: 'Falcon',
          leo_capacity: 22800, launches: 3, successful: 2, active: true,
          thrust: 7607, maiden_flight: '2010-06-04', streak: 2},
      2: {name: 'Sounder', manufacturer_id: 11, leo_capacity: 0,
          launches: 1, successful: 1},
      3: {name: 'OldOrb', manufacturer_id: 10, family: 'Heritage',
          leo_capacity: 0, launches: 1, successful: 1, active: false,
          thrust: 100, maiden_flight: '1961-01-01'},
      4: {name: 'NeverFlew', manufacturer_id: 10, leo_capacity: 5000,
          launches: 0, successful: 0},
      6: {name: 'NoMfr', manufacturer_id: 999, leo_capacity: 10,
          launches: 1, successful: 1},
    },
    agencies: {
      10: {name: 'Space Exploration', abbrev: 'SpaceX', country: 'USA'},
      11: {name: 'SubOrbital Inc', abbrev: 'SubOrb', country: 'FRA'},
    },
    statuses: {
      1: {abbrev: 'Success', name: 'Success'},
      2: {abbrev: 'Failure', name: 'Failure'},
      3: {abbrev: 'TBD', name: 'To Be Determined'},
    },
    pads: {100: {name: 'SLC-40', location_id: 50}},
    locations: {50: {name: 'Cape Canaveral SFS, FL, USA'}},
  };
  if (overrides.meta) Object.assign(data.meta, overrides.meta);
  if (overrides.previous) data.previous = overrides.previous;
  return data;
}

module.exports = {makeData, launch};
