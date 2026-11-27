// Hides a page's content while a shared link's view loads, so the visitor
// sees a blank page instead of the default view flashing first.
//
// The pages render their default view on the server, so their HTML has real
// content in it, and read the URL only after that. Without this, a link like
// /elections?race=council-2022 would show the 2026 mayor results for a moment.
//
// <LinkCover when="..."> renders an inline script that runs while the HTML is
// still being read, before anything is drawn. If `when` (a JS expression with
// `q`, the URL's URLSearchParams) is true, it adds a style that hides every
// `.link-cover` element. The page calls uncoverLink() once the linked view
// has rendered. A plain URL, which is what crawlers fetch, is never covered.
//
// It adds a <style> to <head> rather than an attribute on <html>, since React
// would flag an attribute it didn't render when it hydrates.

const ID = 'link-cover';
// If the page never uncovers (a script error, a very slow network), the
// default view is better than a blank page.
const GIVE_UP_MS = 8000;

export default function LinkCover({ when }) {
  const js = `(function(){try{var q=new URLSearchParams(location.search);if(${when}){`
    + `var s=document.createElement('style');s.id='${ID}';`
    + `s.textContent='.link-cover{visibility:hidden}';document.head.appendChild(s);`
    + `setTimeout(function(){s.remove()},${GIVE_UP_MS});}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

export function uncoverLink() {
  document.getElementById(ID)?.remove();
}
