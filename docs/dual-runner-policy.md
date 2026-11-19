# WiseLead GitHub Actions dual-runner policy

## Operating model

WiseLead uses GitHub-hosted and self-hosted runners for different trust and connectivity boundaries.

- Use GitHub-hosted `ubuntu-latest` runners for stateless, read-only, public-Internet jobs.
- Use WiseLead self-hosted runners for deployments, Azure/terraform, Kubernetes, private registries and networks, OIDC workload identity, E2E against private environments, mobile builds, macOS, Windows, Android, and any job that uses repository or organization secrets.
- Do not replace all `runs-on` values globally. Each hosted exception must name the exact workflow and job.

## First rollout

The first approved hosted workload is secret scanning.

```yaml
jobs:
  gitleaks:
    runs-on: ubuntu-latest

  gitleaks-full:
    runs-on: ubuntu-latest
```

A hosted exception is valid only when:

1. The job has no deployment or private-network dependency.
2. The job requires no repository, organization, environment, or private registry secret.
3. The workflow checks out source only and performs read-only or non-privileged analysis.
4. The repository documents the exact workflow/job exception.
5. A repository policy test, where present, allowlists the exact workflow/job pair and rejects other hosted labels.

## Rollback

Restore the repository's previous self-hosted runner label for a failed or unauthorised hosted job. Remove manual dispatch support if it was added only for pilot validation.

## Tracking

The rollout is tracked in [wiselead-solutions/.github#43](https://github.com/wiselead-solutions/.github/issues/43).
