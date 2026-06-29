import React, { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import springboard from 'springboard';

import {
  buildAgentResultMessage,
  getBeadsForms,
  normalizeFormData,
  sanitizeBeadsFormHtml,
  type BeadLike,
  type BeadsFormDefinition,
  type JsonObject,
} from '../lib/beadsFormCore';

// @platform "node"
import { createNodeBeadsClient } from '../lib/beadsClient.node';
// @platform end

type LoadFormsInput = {
  dir: string;
  beadId: string;
  formId?: string;
};

type LoadFormsResult = {
  bead: BeadLike;
  forms: BeadsFormDefinition[];
  selectedForm?: BeadsFormDefinition;
};

type SubmitFormInput = {
  dir: string;
  beadId: string;
  formId: string;
  values: JsonObject;
};

type SubmitFormResult = {
  beadId: string;
  formId: string;
  values: JsonObject;
  prettySummary: string;
  agentMessage: string;
  reviewLabel: string;
  warnings: string[];
};

function nodeClient() {
  if (typeof createNodeBeadsClient !== 'function') {
    throw new Error('Beads client is only available on the node side of the BeadsForm module');
  }
  return createNodeBeadsClient();
}

function formViewUrl(args: { dir: string; beadId: string; formId?: string }): string {
  const params = new URLSearchParams({ dir: args.dir, bead: args.beadId });
  if (args.formId) params.set('form', args.formId);
  return `/dashboard/forms?${params.toString()}`;
}

type MaybeNestedPromise<T> = Promise<T> | Promise<Promise<T>>;

function BeadsFormRoute({ actions }: { actions: {
  loadBeadForms: (input: LoadFormsInput) => MaybeNestedPromise<LoadFormsResult>;
  submitBeadForm: (input: SubmitFormInput) => MaybeNestedPromise<SubmitFormResult>;
} }) {
  const [params] = useSearchParams();
  const dir = params.get('dir') ?? '';
  const beadId = params.get('bead') ?? '';
  const formId = params.get('form') ?? undefined;
  const returnTo = params.get('returnTo') ?? '';
  const [loaded, setLoaded] = useState<LoadFormsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitFormResult | null>(null);
  const submitInFlightRef = useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    setSubmitResult(null);

    if (!dir || !beadId) {
      setError('Forms require dir and bead query parameters.');
      return;
    }

    void (async () => {
      try {
        const result = await (await actions.loadBeadForms({ dir, beadId, formId }));
        if (!cancelled) setLoaded(result);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actions, beadId, dir, formId]);

  const selectedHtml = useMemo(() => {
    if (!loaded?.selectedForm) return '';
    return sanitizeBeadsFormHtml(loaded.selectedForm.html);
  }, [loaded?.selectedForm]);

  const handleSubmit = async (event: React.FormEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement) || !loaded?.selectedForm) return;
    event.preventDefault();
    if (submitInFlightRef.current) return;
    if (!target.reportValidity()) return;

    const values = normalizeFormData(new FormData(target));
    submitInFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await (await actions.submitBeadForm({
        dir,
        beadId,
        formId: loaded.selectedForm.id,
        values,
      }));
      setSubmitResult(result);
      await navigator.clipboard?.writeText(result.agentMessage).catch(() => undefined);
      if (returnTo) {
        window.location.assign(returnTo);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  if (error && !loaded) {
    return <div className="beadsform-root beadsform-page"><h1>Forms</h1><p role="alert">{error}</p></div>;
  }

  if (!loaded) {
    return <div className="beadsform-root beadsform-page"><h1>Forms</h1><p>Loading bead form…</p></div>;
  }

  const { bead, forms, selectedForm } = loaded;

  return (
    <div className="beadsform-root beadsform-page">
      <header>
        <p className="beadsform-eyebrow">Bead form</p>
        <h1>{bead.id}: {bead.title ?? 'Untitled bead'}</h1>
        {bead.description ? <p>{bead.description}</p> : null}
      </header>

      {forms.length === 0 ? (
        <p>This bead has no attached forms.</p>
      ) : !selectedForm ? (
        <section>
          <h2>Forms</h2>
          <ul>
            {forms.map((form) => (
              <li key={form.id}>
                <a href={formViewUrl({ dir, beadId, formId: form.id })}>{form.title}</a>
                {form.description ? <p>{form.description}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section>
          <div className="beadsform-heading-row">
            <div>
              <h2>{selectedForm.title}</h2>
              {selectedForm.description ? <p>{selectedForm.description}</p> : null}
            </div>
            {forms.length > 1 ? <a href={formViewUrl({ dir, beadId })}>All forms</a> : null}
          </div>
          <div onSubmit={handleSubmit} dangerouslySetInnerHTML={{ __html: selectedHtml }} />
        </section>
      )}

      {error ? <p role="alert" className="beadsform-error">{error}</p> : null}
      {submitting ? <p>Submitting…</p> : null}
      {submitResult ? (
        <section className="beadsform-submit-result">
          <h2>Submitted</h2>
          <p>Copied the agent-facing response text to your clipboard. Navigate back to the Agent tab and paste it there.</p>
          {submitResult.warnings.length > 0 ? (
            <div className="beadsform-warning" role="status">
              <h3>Warnings</h3>
              <ul>{submitResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          ) : null}
          <h3>Pretty summary</h3>
          <pre>{submitResult.prettySummary}</pre>
          <h3>Normalized JSON</h3>
          <pre>{JSON.stringify(submitResult.values, null, 2)}</pre>
          <h3>Agent message</h3>
          <pre>{submitResult.agentMessage}</pre>
        </section>
      ) : null}
    </div>
  );
}

springboard.registerModule(
  'BeadsForm',
  { rpcMode: 'remote' },
  async (moduleAPI) => {
    const actions = moduleAPI.createActions({
      loadBeadForms: async (input: LoadFormsInput): Promise<LoadFormsResult> => {
        if (!input.dir.trim()) throw new Error('dir is required');
        if (!input.beadId.trim()) throw new Error('beadId is required');
        const bead = await nodeClient().readBead(input.dir, input.beadId);
        const forms = getBeadsForms(bead.metadata);
        return {
          bead,
          forms,
          selectedForm: input.formId ? forms.find((form) => form.id === input.formId) : undefined,
        };
      },
      submitBeadForm: async (input: SubmitFormInput): Promise<SubmitFormResult> => {
        const result = await nodeClient().submitForm(input);
        const forms = getBeadsForms(result.metadata);
        const form = forms.find((candidate) => candidate.id === input.formId) ?? { id: input.formId, title: input.formId, html: '' };
        return {
          beadId: input.beadId,
          formId: input.formId,
          values: input.values,
          prettySummary: result.prettySummary,
          agentMessage: buildAgentResultMessage({ beadId: input.beadId, form, values: input.values }),
          reviewLabel: result.reviewLabel,
          warnings: result.warnings,
        };
      },
      removeReviewLabel: async (input: { dir: string; beadId: string; label?: string }) => {
        const label = input.label ?? 'needs-agent-review';
        try {
          await nodeClient().removeLabel(input.dir, input.beadId, label);
          return { success: true, warnings: [] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { success: true, warnings: [`Removing label "${label}" failed: ${message}`] };
        }
      },
    });

    moduleAPI.registerRoute('/dashboard/forms', { hideApplicationShell: true }, () => (
      <BeadsFormRoute actions={actions} />
    ));

    return { actions };
  },
);
