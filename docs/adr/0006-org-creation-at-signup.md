# ADR-0006: Create an organization automatically at signup

Status: Accepted

## Context

AgentTrace is multi-tenant: every project belongs to an organization, and
every user belongs to an organization through a membership. When someone
signs up for the first time, they need an organization to actually create
a project in. We had to decide when that organization gets created.

## Decision

Signup asks for an organization name (`orgName`) along with email,
password, and the user's name, similar to how Slack or Linear ask for a
workspace name during onboarding. In one database transaction, signup
creates the `Organization`, the `User`, and a `Membership` row with the
`OWNER` role, all at once. If any part fails, none of it is saved.

For now, a user has exactly one organization, the one created at signup.
There is no "join an existing organization" or "create a second
organization" flow yet.

## Alternatives considered

- **Create the user first, ask for an organization name later.** Rejected
  for now. It is an extra step with no real benefit at this size, and it
  would mean a brief window where a logged in user has no organization to
  work in.
- **Auto-generate the organization name from the user's name or email**
  (like "Jane's Organization"), instead of asking for one. Rejected.
  Asking directly is more honest about what a real product does, and it
  is only one more form field.
- **Let a user belong to multiple organizations from day one.** Rejected
  for now, on purpose. The schema already supports it (`Membership` is
  its own table, not a column on `User`), so adding multi-org support
  later means adding features, not redesigning the data model. Building
  organization switching now, before there is a dashboard to switch
  between, would be solving a problem we do not have yet.

## Consequences

- Gain: signup produces a fully usable account in one step. A new user
  can create a project immediately after signing up.
- Give up: no organization invites or multi-org membership yet. A user
  cannot currently be added to someone else's organization.
- Later: adding "invite a teammate to your org" or "belong to more than
  one org" will need new endpoints and a way to choose which org is
  active, but not a schema change, since `Membership` already models the
  many to many relationship between users and organizations.
