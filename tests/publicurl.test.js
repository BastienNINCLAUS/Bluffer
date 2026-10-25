import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicUrl, hostnameOf, lanAddress, DEFAULT_HOST_PORT } from '../server/publicUrl.js';

describe('URL publique du QR code', () => {
  test('HOST_IP et HOST_PORT : on utilise le port PUBLIÉ, pas le port interne', () => {
    const url = resolvePublicUrl({
      env: { HOST_IP: '192.168.1.20', HOST_PORT: '4242' },
      requestHost: 'localhost:3000',
    });
    assert.equal(url, 'http://192.168.1.20:4242');
  });

  test('HOST_PORT absent : port par défaut peu courant', () => {
    assert.equal(DEFAULT_HOST_PORT, 3417);
    assert.equal(resolvePublicUrl({ env: { HOST_IP: '10.0.0.5' } }), 'http://10.0.0.5:3417');
  });

  test('PUBLIC_URL explicite prioritaire, sans barre finale', () => {
    const url = resolvePublicUrl({ env: { PUBLIC_URL: 'https://jeu.exemple.fr/', HOST_IP: '1.2.3.4' } });
    assert.equal(url, 'https://jeu.exemple.fr');
  });

  test('sans variables : l’hôte de la requête est repris, sauf localhost', () => {
    assert.equal(resolvePublicUrl({ env: {}, requestHost: '192.168.1.8:3417' }), 'http://192.168.1.8:3417');
    assert.equal(
      resolvePublicUrl({ env: {}, requestHost: 'localhost:3417', lan: '192.168.1.8' }),
      'http://192.168.1.8:3417',
    );
    assert.equal(
      resolvePublicUrl({ env: {}, requestHost: '127.0.0.1:3000', lan: '10.1.1.1' }),
      'http://10.1.1.1:3000',
    );
  });

  test('localhost sans adresse réseau : repli sur la requête', () => {
    assert.equal(resolvePublicUrl({ env: {}, requestHost: 'localhost:3417' }), 'http://localhost:3417');
  });

  test('hostnameOf', () => {
    assert.equal(hostnameOf('exemple.fr:3000'), 'exemple.fr');
    assert.equal(hostnameOf('[::1]:3000'), '[::1]');
    assert.equal(hostnameOf(undefined), '');
  });

  test('lanAddress ignore les interfaces internes et IPv6', () => {
    const interfaces = {
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      eth0: [
        { family: 'IPv6', internal: false, address: 'fe80::1' },
        { family: 'IPv4', internal: false, address: '192.168.1.50' },
      ],
    };
    assert.equal(lanAddress(interfaces), '192.168.1.50');
    assert.equal(lanAddress({ lo: interfaces.lo }), null);
  });
});
