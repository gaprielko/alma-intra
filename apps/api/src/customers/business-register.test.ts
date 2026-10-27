import { lookupCompany, RegisterUnavailableError } from './business-register.js';

const answer = (status: number, body?: unknown) =>
  (() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
    )) as unknown as typeof fetch;

const company = {
  identifiers: [{ value: '35757442', validFrom: '1998-12-07' }],
  fullNames: [
    { value: 'VOLKSWAGEN SLOVAKIA a.s.', validFrom: '1998-12-07', validTo: '1999-10-14' },
    { value: 'VOLKSWAGEN SLOVAKIA, a.s.', validFrom: '1999-10-15' },
  ],
  addresses: [
    {
      validFrom: '1998-12-07',
      validTo: '1999-10-14',
      street: 'J. Jonáša',
      buildingNumber: '1',
      postalCodes: ['84108'],
      municipality: { value: 'Bratislava' },
    },
    {
      validFrom: '1999-10-15',
      street: 'J. Jonáša',
      regNumber: 0,
      buildingNumber: '1',
      postalCodes: ['84302'],
      municipality: { value: 'Bratislava' },
    },
  ],
};

describe('lookupCompany', () => {
  it('fills the current name and seat', async () => {
    expect(await lookupCompany('35757442', answer(200, { results: [company] }))).toEqual({
      ico: '35757442',
      name: 'VOLKSWAGEN SLOVAKIA, a.s.',
      street: 'J. Jonáša 1',
      postalCode: '843 02',
      city: 'Bratislava',
      terminated: false,
    });
  });

  it('writes a numbered address and a village without streets the Slovak way', async () => {
    const village = {
      ...company,
      addresses: [{ regNumber: 120, municipality: { value: 'Lúčky' }, postalCodes: ['03482'] }],
    };
    const town = {
      ...company,
      addresses: [{ street: 'Hlavná', regNumber: 1234, buildingNumber: '5' }],
    };
    expect((await lookupCompany('35757442', answer(200, { results: [village] })))?.street).toBe(
      'Lúčky 120',
    );
    expect((await lookupCompany('35757442', answer(200, { results: [town] })))?.street).toBe(
      'Hlavná 1234/5',
    );
    const cityOnly = {
      ...company,
      addresses: [{ regNumber: 0, municipality: { value: 'Nitra' } }],
    };
    expect(await lookupCompany('35757442', answer(200, { results: [cityOnly] }))).toMatchObject({
      street: null,
      city: 'Nitra',
    });
  });

  it('does not match a company that held the IČO only in the past', async () => {
    const former = {
      ...company,
      identifiers: [
        { value: '35757442', validFrom: '2000-01-01', validTo: '2010-01-01' },
        { value: '30792444', validFrom: '2010-01-02' },
      ],
    };
    expect(await lookupCompany('35757442', answer(200, { results: [former] }))).toBeNull();
    expect(await lookupCompany('35757442', answer(200, { results: [] }))).toBeNull();
    expect(await lookupCompany('35757442', answer(404))).toBeNull();
  });

  it('says when the company has been struck off', async () => {
    const gone = { ...company, terminationDate: '2020-05-01' };
    expect((await lookupCompany('35757442', answer(200, { results: [gone] })))?.terminated).toBe(
      true,
    );
  });

  it('reports an unavailable register instead of an empty result', async () => {
    await expect(lookupCompany('35757442', answer(503))).rejects.toBeInstanceOf(
      RegisterUnavailableError,
    );
    const down = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    await expect(lookupCompany('35757442', down)).rejects.toBeInstanceOf(RegisterUnavailableError);
  });
});
