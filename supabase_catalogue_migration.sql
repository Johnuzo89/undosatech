-- supabase_catalogue_migration.sql
-- Medical Data Catalogue: cohorts table
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/hpfuacpmocnsxdgbnidm/sql/new

CREATE TABLE IF NOT EXISTS cohorts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL,
    slug                    TEXT UNIQUE NOT NULL,
    description             TEXT,
    contributing_institution TEXT NOT NULL,
    country                 TEXT NOT NULL DEFAULT 'United Kingdom',

    -- Clinical classification
    modality                TEXT NOT NULL,
    -- 'OCT' | 'fundus' | 'MRI' | 'CT' | 'histopathology' | 'EEG' | 'mixed'
    disease_area            TEXT NOT NULL,
    disease_tags            TEXT[] DEFAULT '{}',

    -- Size
    sample_count            INTEGER,
    age_range_min           INTEGER,
    age_range_max           INTEGER,
    sex_distribution        JSONB,
    -- e.g. {"male": 52, "female": 48} (percentages)

    -- Technical metadata
    data_format             TEXT DEFAULT 'DICOM',
    -- 'DICOM' | 'BIDS' | 'NIfTI' | 'CSV' | 'mixed'
    imaging_device          TEXT,
    -- e.g. 'Heidelberg Spectralis', 'Siemens 3T MRI'
    longitudinal            BOOLEAN DEFAULT FALSE,
    follow_up_years         NUMERIC,

    -- Access conditions
    access_type             TEXT DEFAULT 'application_required',
    -- 'open' | 'application_required' | 'restricted'
    data_use_conditions     TEXT[] DEFAULT '{}',
    -- e.g. ['research_only', 'no_commercial', 'uk_only', 'ethics_required']
    ethics_reference        TEXT,
    -- REC / IRB reference number

    -- Governance
    consent_basis           TEXT,
    -- 'broad_consent' | 'dynamic_consent' | 'waived' | 'anonymised'
    dspt_compliant          BOOLEAN DEFAULT TRUE,
    ico_registered          BOOLEAN DEFAULT TRUE,

    -- Catalogue metadata
    status                  TEXT DEFAULT 'published'
                            CHECK (status IN ('published', 'pending', 'archived')),
    featured                BOOLEAN DEFAULT FALSE,
    citation                TEXT,
    -- DOI or paper reference if published
    doi                     TEXT,

    published_at            TIMESTAMPTZ DEFAULT NOW(),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cohorts_status    ON cohorts (status);
CREATE INDEX IF NOT EXISTS idx_cohorts_modality  ON cohorts (modality);
CREATE INDEX IF NOT EXISTS idx_cohorts_disease   ON cohorts (disease_area);
CREATE INDEX IF NOT EXISTS idx_cohorts_featured  ON cohorts (featured);

-- Row-level security
ALTER TABLE cohorts ENABLE ROW LEVEL SECURITY;

-- Public read of published cohorts (anon + authenticated)
CREATE POLICY "Public can read published cohorts"
  ON cohorts FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

-- Service role has full access (bypasses RLS — backend admin)


-- ── Seed data: realistic UK vision science / neuroscience cohorts ─────────────

INSERT INTO cohorts (
    name, slug, description, contributing_institution, country,
    modality, disease_area, disease_tags, sample_count,
    age_range_min, age_range_max, sex_distribution,
    data_format, imaging_device, longitudinal, follow_up_years,
    access_type, data_use_conditions, ethics_reference,
    consent_basis, featured, citation
) VALUES

(
    'UK Glaucoma Longitudinal Cohort',
    'uk-glaucoma-longitudinal',
    'Longitudinal OCT and visual field dataset from 1,847 patients with confirmed glaucoma and age-matched controls. Collected at 6 NHS ophthalmology centres across England (2018–2024). Includes Heidelberg Spectralis OCT volumes, Humphrey visual field tests, IOP measurements, and structured clinical metadata in OMOP CDM format.',
    'Moorfields Eye Hospital NHS Foundation Trust',
    'United Kingdom',
    'OCT',
    'Glaucoma',
    ARRAY['glaucoma', 'visual field', 'OCT', 'IOP', 'optic nerve'],
    1847,
    28, 91,
    '{"male": 49, "female": 51}',
    'DICOM',
    'Heidelberg Spectralis OCT',
    TRUE,
    5.2,
    'application_required',
    ARRAY['research_only', 'ethics_required', 'uk_residency_preferred'],
    'REC-22/LO/1847',
    'broad_consent',
    TRUE,
    'Smith et al. (2023). Longitudinal OCT in Glaucoma Management. Eye, 37(4), 821–829. DOI: 10.1038/s41433-022-02345-6'
),

(
    'Scottish Retinal Imaging Network — AMD Cohort',
    'srin-amd',
    'Age-related macular degeneration surveillance cohort with multimodal retinal imaging. Fundus photography, OCT angiography, and fluorescein angiography from 3,204 eyes (2,311 patients). Captures wet and dry AMD at multiple stages. Linked to GP records via CHI number (de-identified). Harmonised to OMOP CDM v5.4.',
    'University of Edinburgh / NHS Lothian',
    'United Kingdom',
    'fundus',
    'Age-related Macular Degeneration',
    ARRAY['AMD', 'drusen', 'neovascularisation', 'OCT-A', 'fundus photography'],
    2311,
    55, 97,
    '{"male": 42, "female": 58}',
    'DICOM',
    'Topcon Maestro2 / Canon CR-2',
    TRUE,
    3.8,
    'application_required',
    ARRAY['research_only', 'ethics_required', 'no_commercial'],
    'IRAS/282651',
    'dynamic_consent',
    TRUE,
    NULL
),

(
    'Diabetic Retinopathy Screening Archive — North West',
    'dr-screening-nw',
    'Retrospective archive of diabetic retinopathy screening photographs from the NHS Diabetic Eye Screening Programme in North West England. 94,217 fundus image pairs (one per eye) from 52,440 patients screened 2012–2022. Graded by certified screeners. Anonymised via NHS pseudonymisation protocol ISB1523.',
    'NHS Greater Manchester Integrated Care',
    'United Kingdom',
    'fundus',
    'Diabetic Retinopathy',
    ARRAY['diabetic retinopathy', 'diabetic macular oedema', 'grading', 'screening'],
    52440,
    18, 89,
    '{"male": 53, "female": 47}',
    'DICOM',
    'Topcon TRC-NW400 / Zeiss Visucam',
    FALSE,
    NULL,
    'application_required',
    ARRAY['research_only', 'ethics_required', 'uk_only'],
    'IRAS/312004',
    'broad_consent',
    FALSE,
    NULL
),

(
    'BRain Imaging Genetics Study (BRIGS) — Neuroimaging Cohort',
    'brigs-neuroimaging',
    'Multimodal neuroimaging cohort with structural MRI (T1w, T2w, FLAIR), diffusion tensor imaging (DTI), and resting-state fMRI. Participants recruited from the Generation Scotland and UK Biobank volunteers (N=2,109). Phenotyped for depression, anxiety, and cognitive performance. All MRI data converted to BIDS v1.8 format.',
    'University of Edinburgh / Centre for Clinical Brain Sciences',
    'United Kingdom',
    'MRI',
    'Neuroscience',
    ARRAY['structural MRI', 'DTI', 'fMRI', 'depression', 'cognition', 'BIDS'],
    2109,
    40, 80,
    '{"male": 44, "female": 56}',
    'BIDS',
    'Siemens Prisma 3T MRI',
    FALSE,
    NULL,
    'application_required',
    ARRAY['research_only', 'ethics_required', 'no_commercial', 'uk_residency_preferred'],
    'REC-18/SS/0163',
    'broad_consent',
    TRUE,
    NULL
),

(
    'Paediatric Epilepsy EEG Archive',
    'paediatric-epilepsy-eeg',
    'Annotated EEG archive from paediatric patients (age 2–18) with confirmed epilepsy diagnoses at Great Ormond Street Hospital. 1,204 EEG recordings (average 3.2 hours each) with expert seizure annotations. Includes ICD-10 coded diagnoses, AED medication history, and seizure frequency metadata.',
    'Great Ormond Street Hospital NHS Foundation Trust',
    'United Kingdom',
    'EEG',
    'Epilepsy',
    ARRAY['epilepsy', 'seizure', 'EEG', 'paediatric', 'annotation'],
    412,
    2, 18,
    '{"male": 57, "female": 43}',
    'CSV',
    'Nihon Kohden EEG-1200',
    TRUE,
    2.1,
    'restricted',
    ARRAY['research_only', 'ethics_required', 'no_commercial', 'uk_only', 'paediatric_data_agreement'],
    'REC-20/LO/0931',
    'dynamic_consent',
    FALSE,
    NULL
),

(
    'Oxford Cognitive Ageing Project — Retinal Biomarkers',
    'ocap-retinal',
    'Prospective cohort linking retinal imaging with cognitive assessments in community-dwelling adults aged 60+. Includes baseline and 3-year follow-up OCT, fundus photography, and standardised cognitive battery (MoCA, ACE-III). N=788 participants. Exploratory investigation of retinal biomarkers for Alzheimer''s disease risk.',
    'University of Oxford / Nuffield Department of Clinical Neurosciences',
    'United Kingdom',
    'OCT',
    'Alzheimer''s Disease',
    ARRAY['Alzheimer''s', 'cognitive ageing', 'retinal biomarkers', 'MoCA', 'OCT', 'longitudinal'],
    788,
    60, 87,
    '{"male": 41, "female": 59}',
    'DICOM',
    'Heidelberg Spectralis OCT',
    TRUE,
    3.0,
    'application_required',
    ARRAY['research_only', 'ethics_required'],
    'OxREC 20/A/0217',
    'broad_consent',
    FALSE,
    NULL
),

(
    'Keratoconic Cornea Imaging Biobank',
    'keratoconus-biobank',
    'Cross-sectional corneal imaging dataset for keratoconus research. Includes Scheimpflug tomography (Pentacam), anterior segment OCT, and corneal topography from 1,033 keratoconic eyes and 892 normal controls. Clinical severity graded by Amsler-Krumeich and ABCD classification. Data from 4 UK corneal specialist centres.',
    'Moorfields Eye Hospital NHS Foundation Trust',
    'United Kingdom',
    'OCT',
    'Keratoconus',
    ARRAY['keratoconus', 'cornea', 'Scheimpflug', 'tomography', 'anterior segment OCT'],
    962,
    16, 65,
    '{"male": 66, "female": 34}',
    'DICOM',
    'Oculus Pentacam / Zeiss Cirrus HD-OCT',
    FALSE,
    NULL,
    'application_required',
    ARRAY['research_only', 'ethics_required'],
    'REC-21/LO/0442',
    'broad_consent',
    FALSE,
    NULL
),

(
    'MS Neuroimaging Cohort — Wales',
    'ms-neuro-wales',
    'Longitudinal MRI cohort for multiple sclerosis research recruited from the Wales MS Centre. Serial brain and spinal cord MRI (T1w, T2-FLAIR, DTI) at baseline, 12, and 24 months. Includes EDSS disability scores, relapse records, and DMT history. N=634 participants. Converted to BIDS with spinal cord toolbox preprocessing.',
    'Cardiff University Brain Research Imaging Centre',
    'United Kingdom',
    'MRI',
    'Multiple Sclerosis',
    ARRAY['multiple sclerosis', 'white matter', 'FLAIR', 'spinal cord', 'EDSS', 'longitudinal'],
    634,
    20, 72,
    '{"male": 33, "female": 67}',
    'BIDS',
    'Siemens Skyra 3T MRI',
    TRUE,
    2.0,
    'application_required',
    ARRAY['research_only', 'ethics_required', 'wales_partnership_agreement'],
    'REC-19/WA/0214',
    'broad_consent',
    FALSE,
    NULL
);


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT id, name, modality, disease_area, sample_count, status
FROM cohorts
ORDER BY featured DESC, sample_count DESC;
