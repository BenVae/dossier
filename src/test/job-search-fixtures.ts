// Answers from job sources for the tests (E14), in each source's own shape,
// with made-up companies and people.

const ledgerly = {
  job_id: "aG9tZWQtZGVzaWduZXItbGVkZ2VybHk=",
  job_title: "Senior Product Designer, Payments",
  employer_name: "Ledgerly",
  employer_logo: "https://example.com/ledgerly.png",
  job_publisher: "LinkedIn",
  job_employment_type: "Full-time",
  job_apply_link: "https://www.linkedin.com/jobs/view/1234567890?utm_source=google_jobs_apply",
  job_apply_is_direct: false,
  apply_options: [
    { publisher: "LinkedIn", apply_link: "https://www.linkedin.com/jobs/view/1234567890?utm_source=google_jobs_apply", is_direct: false },
    { publisher: "Ledgerly Careers", apply_link: "https://careers.ledgerly.example/jobs/42", is_direct: true },
  ],
  job_description: "Ledgerly is hiring a Senior Product Designer for its payments team.\n\nYou'll design checkout flows.\n\n• 5+ years of product design\n• Figma",
  job_is_remote: false,
  job_posted_at_datetime_utc: "2026-09-30T08:00:00.000Z",
  job_posted_at_timestamp: 1790755200,
  // As JSearch writes it: in the country's language, with the publisher.
  job_location: "Hamburg     •  über LinkedIn",
  job_city: null,
  job_state: null,
  job_country: "DE",
  job_latitude: 53.55,
  job_longitude: 9.99,
  job_min_salary: 75000,
  job_max_salary: 90000,
  job_salary_currency: "EUR",
  job_salary_period: "YEAR",
  job_google_link: "https://www.google.com/search?q=jobs&ibp=htl;jobs#htidocid=abc",
};

const northwind = {
  job_id: "bm9ydGh3aW5kLXV4LXJlc2VhcmNo",
  job_title: "UX Researcher",
  employer_name: "Northwind Studio",
  job_publisher: "Indeed",
  job_apply_link: "https://de.indeed.com/viewjob?jk=abc123&from=serp",
  apply_options: [{ publisher: "Indeed", apply_link: "https://de.indeed.com/viewjob?jk=abc123&from=serp", is_direct: false }],
  job_description: "Northwind Studio is looking for a UX Researcher, fully remote within Germany.",
  job_is_remote: true,
  job_posted_at_datetime_utc: null,
  job_posted_at_timestamp: 1790582400,
  job_location: null,
  job_city: "Berlin",
  job_state: null,
  job_country: "DE",
  job_min_salary: null,
  job_max_salary: null,
  job_salary_currency: null,
  job_salary_period: null,
};

/** OpenWeb Ninja's search-v2: jobs and the next page's cursor under `data`. */
export const jsearchV2Page = {
  status: "OK",
  request_id: "c8f1b2a4-0000-4000-8000-000000000001",
  parameters: { query: "product designer in Hamburg", country: "de" },
  data: {
    jobs: [
      ledgerly,
      northwind,
      // Repeated across publishers: kept once.
      ledgerly,
      // Without an id: skipped.
      { job_title: "No id" },
    ],
    cursor: "CURSOR-PAGE-2",
  },
};

/** The last search-v2 page: no cursor. */
export const jsearchV2LastPage = { status: "OK", request_id: "r2", parameters: {}, data: { jobs: [northwind], cursor: null } };

/** What JSearch says to a key it doesn't know. */
export const jsearchKeyError = { status: "ERROR", request_id: "r4", error: { message: "Invalid API key", code: 401 } };

/** Adzuna's search, as its docs describe it: a snippet with HTML, the company and place as objects. */
export const adzunaPage = {
  __CLASS__: "Adzuna::API::Response::JobSearchResults",
  count: 45,
  mean: 61000,
  results: [
    {
      __CLASS__: "Adzuna::API::Response::Job",
      id: "4721394012",
      adref: "eyJhbGciOiJIUzI1NiJ9",
      title: "Senior <strong>Product Designer</strong> &amp; Researcher",
      description: "Ledgerly is hiring a <strong>Product Designer</strong> for its payments team…",
      created: "2026-09-29T09:15:00Z",
      redirect_url: "https://www.adzuna.de/land/ad/4721394012?se=abc&utm_medium=api&utm_source=dossier&v=1",
      company: { __CLASS__: "Adzuna::API::Response::Company", display_name: "Ledgerly GmbH" },
      location: { __CLASS__: "Adzuna::API::Response::Location", display_name: "Hamburg, Deutschland", area: ["Deutschland", "Hamburg"] },
      salary_min: 70000,
      salary_max: 85000,
      salary_is_predicted: "1",
      contract_time: "full_time",
      category: { label: "IT-Stellen", tag: "it-jobs" },
      latitude: 53.55,
      longitude: 9.99,
    },
    {
      id: 4721394013,
      title: "UX Researcher",
      description: null,
      created: "not a date",
      redirect_url: "javascript:alert(1)",
      company: null,
      location: { display_name: "Berlin" },
    },
    // Without an id: skipped.
    { title: "No id" },
  ],
};

/** The Arbeitsagentur's v6 search, as it answered on 3 October 2026 (company and address made up). */
export const arbeitsagenturPage = {
  ergebnisliste: [
    {
      stellenangebotsart: "ARBEIT",
      stellenangebotsTitel: "Softwareentwickler (m/w/d)",
      arbeitszeitVollzeit: true,
      stellenlokationen: [
        { adresse: { strasse: "Hafenstraße", plz: "20457", ort: "Hamburg", region: "HAMBURG", land: "DEUTSCHLAND" }, breite: 53.54, laenge: 10.0 },
        { adresse: { plz: "23552", ort: "Lübeck", region: "SCHLESWIG_HOLSTEIN", land: "DEUTSCHLAND" } },
        { adresse: { ort: "Hamburg" } },
      ],
      homeofficemoeglich: true,
      homeofficetyp: "ANGABE_IN_PROZENT",
      homeofficeprozent: 60,
      datumErsteVeroeffentlichung: "2026-09-28",
      firma: "Hafenlogik GmbH",
      referenznummer: "10001-1003486534-S",
      entfernung: 3,
      gehaltsspanneVon: 55000,
      gehaltsspanneBis: 68000,
    },
    {
      stellenangebotsTitel: "Remote Backend Developer",
      stellenlokationen: [],
      homeofficeprozent: 100,
      firma: "Nordlicht Software",
      referenznummer: "12265-0000912345-S",
      externeURL: "https://karriere.nordlicht.example/jobs/7",
      datumErsteVeroeffentlichung: null,
    },
    // Without a reference number: skipped.
    { stellenangebotsTitel: "No reference" },
  ],
  maxErgebnisse: 60,
  page: 1,
  size: 25,
  woOutput: { suchmittelpunkt: { lat: 53.55, lon: 9.99 } },
  facetten: {},
};

/** The Arbeitsagentur's v4 job details: the description in light Markdown. */
export const arbeitsagenturDetails = {
  stellenangebotsTitel: "Softwareentwickler (m/w/d)",
  stellenangebotsBeschreibung: "**Wer wir sind**\r\nHafenlogik baut Software für den Hafen.\r\n\r\n\r\n**Was du machst**\n- APIs bauen\n- Tests schreiben",
  referenznummer: "10001-1003486534-S",
};

const rwthRow = (link: string, published: string, unit: string) => `<tr>
<td style="--col-width: 45.4%; --text-align: left;">
<h3 class="h5 mobile-caption sortable">
<a href="/cms/root/wir/Karriere/~buym/RWTH-Jobportal/lidx/1/?sortby=STELLENBEZ&amp;asc=1#search-results" class="no-decorations">Job Description</a>
</h3>${link}<br />[published ${published}]</td>
<td style="--col-width: 36.2%; --text-align: left;">
<h3 class="h5 mobile-caption sortable">
<a href="/cms/root/wir/Karriere/~buym/RWTH-Jobportal/lidx/1/?sortby=ANTRAGSTELLER&amp;asc=1#search-results" class="no-decorations">RWTH Institution/Unit [IKZ]</a>
</h3>${unit}</td>
</tr>`;

/** The RWTH job portal's English listings, as they read on 25 October 2026, cut to four rows. */
export const rwthPage = `<!DOCTYPE html><html lang="en"><body><main>
<div class="result-wrapper">
<h2 class="h3 result-count skip-to-module" id="search-results">Showing 1 - 50 of 184 Results</h2>
<div class="paging-wrapper"><div class="last-next-wrapper"><a class="no-decorations pager next" href="/cms/root/wir/Karriere/~buym/RWTH-Jobportal/lidx/1/?page=2#search-results">Next Page</a><a class="no-decorations pager last" href="/cms/root/wir/Karriere/~buym/RWTH-Jobportal/lidx/1/?page=4#search-results">Last Page</a></div></div><table class="results">
<tbody>
${rwthRow('<a href="/go/id/kbag/file/V000011619/lidx/1/" target="_self" class="iconless">Research Assistant (f/m/d) - Experimental Hybrid Additive Manufacturing and Microstructure Characterization [V000011619]</a>', "19/10/2026", "Chair for Digital Additive Production [421510]")}
${rwthRow('<a href="/go/id/kbag/file/V000011488/" target="_self" class="iconless">Sachgebietsleiter*in für das Sachgebiet 10.34 Abwasser-, Wasser- und Gasanlagen (w/m/d) (in German only) [V000011488]</a>', "19/10/2026", "Division 10.3 - Technical Facilities Management - Mechanical Systems [011030]")}
${rwthRow('<a href="/go/id/kbag/file/V000011524/" target="_self" class="iconless">Softwareentwickler*in (w/m/d) für die landesweite KI-Plattform der NRW-Hochschulen &#8211; Projekt KI:Expertisezentrum.nrw (in German only) [V000011524]</a>', "05/10/2026", "IT Center [022000]")}
${rwthRow('<a href="/go/id/kbag/file/V000011580/lidx/1/" target="_self" class="iconless">Research Assistant/Associate (f/m/d) [V000011580]</a><br/>Physical AI &amp; Robot Learning', "05/10/2026", "Chair of Imaging and Computer Vision [611710]")}
</tbody>
</table>
</div></main></body></html>`;
