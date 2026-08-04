import { createForm } from "./actions";
import { requireSession } from "../../../../lib/session";
export const metadata = { title: "Create form" };
export default async function NewForm() {
  await requireSession();
  return (
    <div className="container page">
      <p className="eyebrow">Onboarding</p>
      <h1>Create your first form</h1>
      <p className="lead">
        Define the real frontend, expected fields, origin, success behavior, and notification
        intent.
      </p>
      <form action={createForm} className="card">
        <label className="field">
          Form name
          <input name="name" defaultValue="Contact form" required minLength={2} />
        </label>
        <label className="field">
          Template
          <select name="template">
            <option value="contact">Contact</option>
            <option value="lead">Lead capture</option>
            <option value="support">Support request</option>
          </select>
        </label>
        <label className="field">
          Platform
          <select name="platform">
            <option value="lovable">Lovable</option>
            <option value="bolt">Bolt</option>
            <option value="v0">v0</option>
            <option value="cursor">Cursor</option>
            <option value="claude-code">Claude Code</option>
            <option value="replit">Replit</option>
            <option value="windsurf">Windsurf</option>
            <option value="framer">Framer</option>
            <option value="webflow">Webflow</option>
            <option value="react">React</option>
            <option value="nextjs">Next.js</option>
            <option value="vue">Vue</option>
            <option value="svelte">Svelte</option>
            <option value="astro">Astro</option>
            <option value="html">Plain HTML</option>
          </select>
        </label>
        <label className="field">
          Form page URL
          <input name="sourceUrl" type="url" placeholder="https://example.com/contact" />
        </label>
        <label className="field">
          Allowed domains, one URL per line
          <textarea name="allowedOrigins" defaultValue="http://localhost:3000" rows={3} />
        </label>
        <label className="field">
          Success redirect (optional)
          <input name="successRedirect" type="url" />
        </label>
        <label className="field">
          Notification email (intent only in Phase 1)
          <input name="notificationEmail" type="email" />
        </label>
        <label className="field">
          Honeypot field
          <input name="honeypotField" defaultValue="company_website" required />
        </label>
        <fieldset>
          <legend>Expected fields</legend>
          <label className="field">
            Field name
            <input name="fieldName" defaultValue="email" required />
          </label>
          <label className="field">
            Field type
            <select name="fieldType" defaultValue="email">
              <option value="text">text</option>
              <option value="email">email</option>
              <option value="textarea">textarea</option>
              <option value="tel">tel</option>
              <option value="url">url</option>
              <option value="number">number</option>
              <option value="checkbox">checkbox</option>
            </select>
          </label>
          <label>
            <input name="fieldRequired-0" type="checkbox" defaultChecked /> Required
          </label>
          <label className="field">
            Field name
            <input name="fieldName" defaultValue="message" required />
          </label>
          <label className="field">
            Field type
            <select name="fieldType" defaultValue="textarea">
              <option value="text">text</option>
              <option value="email">email</option>
              <option value="textarea">textarea</option>
              <option value="tel">tel</option>
              <option value="url">url</option>
              <option value="number">number</option>
              <option value="checkbox">checkbox</option>
            </select>
          </label>
          <label>
            <input name="fieldRequired-1" type="checkbox" defaultChecked /> Required
          </label>
        </fieldset>
        <button className="button" type="submit">
          Create endpoint and setup
        </button>
      </form>
    </div>
  );
}
