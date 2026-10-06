import {expect,it} from 'vitest';
import {isPublicWebRequest} from './public-web-request.ts';
it('recognises the explicit public audit request',()=>{
  expect(isPublicWebRequest('Can you check the live ScaleSmiths site for me and audit where we are at? https://scalesmiths.co.uk')).toBe(true);
});
it.each(['Compare the website https://scalesmiths.co.uk with our private revenue','Check the site we discussed earlier https://scalesmiths.co.uk','Check the site https://localhost','Check the site https://example.com?token=secret','Check the site https://user:secret@example.com','Check the site https://10.0.0.1','Continue that audit'])('keeps mixed or contextual requests private: %s',text=>{
  expect(isPublicWebRequest(text)).toBe(false);
});
