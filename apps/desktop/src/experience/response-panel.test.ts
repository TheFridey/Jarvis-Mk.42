import { describe,it,expect } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// Root tests use non-JSX compilation; load the presentation component through Vite.
const modulePath='./response-panel.tsx';
const {ResponsePanel}=await import(modulePath) as {ResponsePanel:ComponentType<{text:string;answerId?:string;live:boolean}>};
describe('readable response presentation',()=>{
  it('renders report headings, emphasis, lists and usable citations',()=>{
    const html=renderToStaticMarkup(createElement(ResponsePanel,{text:'## Audit\n\n**Finding**\n\n- One\n- Two\n\n[Source](https://example.com)',answerId:'answer',live:true}));
    expect(html).toContain('<h2>Audit</h2>');expect(html).toContain('<strong>Finding</strong>');expect(html).toContain('<li>One</li>');expect(html).toContain('rel="noopener noreferrer"');expect(html).not.toContain('## Audit');
    expect(html.match(/value="kokoro:/g)).toHaveLength(13);expect(html).toContain('>Preview</button>');expect(html).toContain('Free male voices · British English');
  });
  it('does not execute embedded HTML, unsafe links or remote images',()=>{
    const html=renderToStaticMarkup(createElement(ResponsePanel,{text:'<script>alert(1)</script>\n\n[Bad](javascript:alert)\n\n![Image](https://example.com/tracker.png)',live:true}));
    expect(html).not.toContain('<script');expect(html).not.toContain('javascript:');expect(html).not.toContain('<img');
  });
});
