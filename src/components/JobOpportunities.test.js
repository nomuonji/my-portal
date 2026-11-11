import { render, screen } from '@testing-library/react';
import JobOpportunities from './JobOpportunities';
import { pick, toList, toText } from './jobOpportunityView';

jest.mock('../firebase', () => ({
  auth: { currentUser: { getIdToken: () => Promise.resolve('token') } },
}));

// Shape taken from the production record that blanked the page: locationEligibility is an object,
// observedFacts is a list of objects, reward inside attributes is an object.
const RECORDS = [
  {
    id: 'job_object_fields',
    title: 'OneForma — Multilingual AI Response Evaluator',
    sourcePublisher: 'OneForma',
    sourceUrl: 'https://www.oneforma.com/projects/example',
    summary: 'Japan eligibility conflicts within the listing.',
    reward: 'Paid per hour',
    status: 'watching',
    tags: [],
    attributes: {
      locationEligibility: { selector: 'Japanese (Japan)', japanEligibility: 'conflicting' },
      jobType: 'remote AI response evaluation',
      reward: { official: 'not shown', secondaryListings: 'USD 35/hour' },
      observedFacts: [{ label: 'Location', value: 'Japan; Remote' }],
      privacy: { risk: 'high', retention: 'no fixed period' },
      requiredApplicantData: { email: 'required', phone: { value: 'unknown' } },
    },
  },
  {
    id: 'job_newer_keys',
    title: 'Welo Data — Ads Quality Rater',
    sourcePublisher: 'Welo Data',
    sourceUrl: 'https://jobs.lever.co/example',
    status: 'active',
    attributes: { location: 'Japan; remote', employmentType: 'Freelance', requiredApplicantData: {} },
  },
];

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: RECORDS }) }));
});

test('renders records whose attributes are nested objects instead of blanking', async () => {
  render(<JobOpportunities />);
  expect(await screen.findByText('OneForma — Multilingual AI Response Evaluator')).toBeInTheDocument();
  expect(screen.getAllByText('selector: Japanese (Japan); japanEligibility: conflicting').length).toBeGreaterThan(0);
  // Newer records use location/employmentType; they still show as chips.
  expect(screen.getAllByText('Japan; remote').length).toBeGreaterThan(0);
  expect(screen.getByText('Freelance')).toBeInTheDocument();
});

test('toText flattens any shape to a string', () => {
  expect(toText(null)).toBe('');
  expect(toText(['a', { b: 1 }])).toBe('a / b: 1');
  expect(toText({ a: { b: ['x', 'y'] }, c: '' })).toBe('a: b: x / y');
  expect(toList({ k: 'v' })).toEqual(['k: v']);
  expect(pick({ a: '', b: 'value' }, 'a', 'b')).toBe('value');
});
