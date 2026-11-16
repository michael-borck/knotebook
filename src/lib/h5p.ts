import { createZip } from './zip'

export interface H5pOptions {
  title: string
  html: string
  author?: string
  license?: string
}

const STORY_SCRIPT = `H5P.KnotebookStory = function (options, id) {
  this.options = options || {};
  this.id = id;
};

H5P.KnotebookStory.prototype.attach = function ($) {
  var frame = $('<iframe class="h5p-knotebook-frame" title="Knotebook story"></iframe>');
  frame.attr('sandbox', 'allow-scripts');
  var wrapper = $('<div class="h5p-knotebook"></div>').append(frame);
  this.$container = wrapper.appendTo($);
  frame.get(0).srcdoc = this.options.html || '';
};`

const STORY_CSS = `.h5p-knotebook {
  width: 100%;
}

.h5p-knotebook-frame {
  display: block;
  width: 100%;
  height: 720px;
  border: 0;
  background: #101117;
}`

export function buildH5pPackage({
  title,
  html,
  author,
  license = 'CC BY 4.0',
}: H5pOptions): Uint8Array {
  const authors = author
    ? [{ name: author, role: 'Author' }]
    : [{ name: 'Knotebook', role: 'Author' }]

  const manifest = {
    title,
    language: 'en',
    mainLibrary: 'H5P.KnotebookStory',
    embedTypes: ['div'],
    license,
    metadata: {
      title,
      authors,
      license,
    },
    preloadedDependencies: [
      {
        machineName: 'H5P.KnotebookStory',
        majorVersion: 1,
        minorVersion: 0,
      },
    ],
  }

  const content = {
    library: 'H5P.KnotebookStory 1.0',
    params: {
      html,
    },
    metadata: {
      title,
      authors,
      license,
    },
  }

  const library = {
    title: 'Knotebook Story',
    machineName: 'H5P.KnotebookStory',
    majorVersion: 1,
    minorVersion: 0,
    patchVersion: 0,
    runnable: 1,
    author: 'Knotebook',
    license: 'MIT',
    coreApi: {
      majorVersion: 1,
      minorVersion: 27,
    },
    preloadedJs: [{ path: 'scripts/story.js' }],
    preloadedCss: [{ path: 'styles/story.css' }],
  }

  const semantics = [
    {
      name: 'html',
      type: 'text',
      widget: 'textarea',
      label: 'Story HTML',
      description: 'The self-contained Knotebook reader.',
      optional: false,
    },
  ]

  return createZip({
    'h5p.json': JSON.stringify(manifest, null, 2),
    'content/content.json': JSON.stringify(content),
    'H5P.KnotebookStory/library.json': JSON.stringify(library, null, 2),
    'H5P.KnotebookStory/semantics.json': JSON.stringify(semantics, null, 2),
    'H5P.KnotebookStory/scripts/story.js': STORY_SCRIPT,
    'H5P.KnotebookStory/styles/story.css': STORY_CSS,
  })
}