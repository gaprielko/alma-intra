import { sk } from '@intra/shared/i18n';
import {
  createCustomerSchema,
  CUSTOMER_STATUSES,
  type CreateCustomerInput,
  type CustomerKind,
  REGIONS,
} from '@intra/shared/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, UserRound } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { type Resolver, useForm, useFormContext, useWatch } from 'react-hook-form';
import { TagChip } from '@/components/customers/customer-bits';
import {
  emptyPerson,
  PersonFields,
  type PersonValues,
  TextField,
} from '@/components/customers/person-fields';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { FormSection } from '@/components/ui/form-section';
import { Input, Textarea } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { applyServerFieldErrors, refusedField } from '@/lib/form-errors';
import { useSession } from '@/lib/session';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const t = sk.customers.form;

/** The items a form offers: the switched-on ones, and the one already chosen even if off. */
const offered = <T extends { id: string; active: boolean }>(
  items: T[] | undefined,
  chosen: string,
) => (items ?? []).filter((item) => item.active || item.id === chosen);
const NEW_TYPE = '__new';

/** Everything the form edits, flat, both kinds' fields at once; the schema keeps the kind's. */
export interface CustomerFormValues {
  customer: PersonValues & {
    kind: CustomerKind;
    name: string;
    ico: string;
    dic: string;
    icDph: string;
    web: string;
    typeId: string;
    status: (typeof CUSTOMER_STATUSES)[number];
    street: string;
    postalCode: string;
    city: string;
    region: string;
    ownerUserId: string;
    sourceId: string;
    tags: string[];
    note: string;
    almaOrganizationId: string;
    receivesBulk: boolean;
  };
  withFirstContact: boolean;
  firstContact: PersonValues;
}

export function emptyCustomer(ownerUserId: string): CustomerFormValues {
  return {
    customer: {
      ...emptyPerson(),
      kind: 'organization',
      name: '',
      ico: '',
      dic: '',
      icDph: '',
      web: '',
      typeId: '',
      status: 'lead',
      street: '',
      postalCode: '',
      city: '',
      region: '',
      ownerUserId,
      sourceId: '',
      tags: [],
      note: '',
      almaOrganizationId: '',
      receivesBulk: true,
    },
    withFirstContact: false,
    firstContact: emptyPerson(),
  };
}

/** The values as the API takes them: ids or nothing, the first contact only when asked for. */
function toInput(values: CustomerFormValues) {
  const c = values.customer;
  return {
    customer: {
      ...c,
      typeId: c.typeId || null,
      region: c.region || null,
      ownerUserId: c.ownerUserId || null,
      sourceId: c.sourceId || null,
      gender: c.gender || undefined,
    },
    firstContact:
      values.withFirstContact && c.kind === 'organization'
        ? { ...values.firstContact, gender: values.firstContact.gender || undefined }
        : undefined,
  };
}

const schemaResolver = zodResolver(createCustomerSchema);
/** Checks the values as the API will get them; the error paths are the form's own. */
const resolver: Resolver<CustomerFormValues, unknown, CreateCustomerInput> = async (
  values,
  context,
  options,
) => {
  // The schema decides by `kind`; the flat values satisfy either branch's fields.
  const result = await schemaResolver(toInput(values) as never, context, options as never);
  return result;
};

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string | undefined;
  children: ReactNode;
}) {
  return (
    <FormSection
      title={
        <>
          {title}
          {lead ? (
            <span className="mt-1 block text-[13px] leading-[18px] font-normal tracking-normal text-muted">
              {lead}
            </span>
          ) : null}
        </>
      }
    >
      {children}
    </FormSection>
  );
}

/**
 * Nový zákazník and Upraviť zákazníka: the kind first (it decides the fields, and is fixed once
 * saved), the basics, the address, the classification and, for a new organization, its first
 * contact.
 */
export function CustomerForm({
  initial,
  editing,
  submitLabel = t.submit,
  pending,
  onSubmit,
  onCancel,
  serverError,
}: {
  initial: CustomerFormValues;
  editing: boolean;
  submitLabel?: string;
  pending: boolean;
  onSubmit: (input: CreateCustomerInput) => void;
  onCancel: () => void;
  /** The last refusal of the save, put on its field when it names one. */
  serverError: unknown;
}) {
  const form = useForm<CustomerFormValues, unknown, CreateCustomerInput>({
    resolver,
    defaultValues: initial,
  });
  const kind = useWatch({ control: form.control, name: 'customer.kind' });
  const withFirstContact = useWatch({ control: form.control, name: 'withFirstContact' });

  const { setError } = form;
  useEffect(() => {
    if (!serverError) return;
    const field = refusedField(serverError, {
      ICO_TAKEN: ['customer.ico', 'ico_taken'] as const,
    });
    if (field) setError(field[0], { type: 'server', message: field[1] });
    else applyServerFieldErrors(serverError, setError);
  }, [serverError, setError]);

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
        className="space-y-5"
      >
        <Card className="@container space-y-6 p-6">
          {editing ? null : (
            <Section title={t.kind.title} lead={t.kind.lead}>
              <KindChoice />
            </Section>
          )}
          {kind === 'organization' ? <OrganizationBasics /> : <IndividualBasics />}
          <Section
            title={sk.customers.form.address.title}
            lead={kind === 'organization' ? t.address.lead : t.address.personLead}
          >
            <div className="grid gap-4 @md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <TextField
                name="customer.street"
                label={t.address.street}
                autoComplete="street-address"
              />
              <TextField
                name="customer.postalCode"
                label={t.address.postalCode}
                autoComplete="postal-code"
              />
              <TextField
                name="customer.city"
                label={t.address.city}
                autoComplete="address-level2"
              />
              <SelectField name="customer.region" label={t.address.region}>
                <SelectItem value="">{t.address.noRegion}</SelectItem>
                {REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {sk.customers.region[r]}
                  </SelectItem>
                ))}
              </SelectField>
            </div>
          </Section>
          <Classification />
          {kind === 'organization' && !editing ? (
            <Section title={t.firstContact.title} lead={t.firstContact.lead}>
              {withFirstContact ? (
                <div className="space-y-4">
                  <PersonFields prefix="firstContact" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => form.setValue('withFirstContact', false)}
                  >
                    {t.firstContact.remove}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => form.setValue('withFirstContact', true)}
                >
                  <Plus className="size-4" aria-hidden />
                  {t.firstContact.add}
                </Button>
              )}
            </Section>
          ) : null}
        </Card>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {sk.common.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? sk.common.saving : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function KindChoice() {
  const { control } = useFormContext<CustomerFormValues>();
  const options = [
    { key: 'organization' as const, icon: Building2, text: t.kind.organizationText },
    { key: 'individual' as const, icon: UserRound, text: t.kind.individualText },
  ];
  return (
    <FormField
      control={control}
      name="customer.kind"
      render={({ field }) => (
        <div role="radiogroup" aria-label={t.kind.title} className="grid gap-3 @md:grid-cols-2">
          {options.map(({ key, icon: Icon, text }) => {
            const on = field.value === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => field.onChange(key)}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                  on
                    ? 'border-2 border-primary bg-primary-soft/50'
                    : 'border-border hover:bg-hover',
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-text">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{sk.customers.kind[key]}</span>
                  <span className="block text-[13px] text-muted">{text}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    />
  );
}

function SelectField({
  name,
  label,
  children,
  onPick,
}: {
  name: string;
  label: string;
  children: ReactNode;
  /** A value that is an action, not a choice (`Nový typ organizácie`): handled here, never set. */
  onPick?: (value: string) => boolean;
}) {
  const { control } = useFormContext();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Select
              value={(field.value as string) ?? ''}
              onChange={(value) => {
                if (onPick?.(value)) return;
                field.onChange(value);
              }}
              onBlur={field.onBlur}
              ref={field.ref}
            >
              {children}
            </Select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function OrganizationBasics() {
  return (
    <Section title={t.basics.title}>
      <div className="grid gap-4 @md:grid-cols-2">
        <TextField name="customer.name" label={t.basics.name} autoComplete="organization" />
        <TypeField />
        <TextField name="customer.ico" label={t.basics.ico} />
        <TextField name="customer.dic" label={t.basics.dic} />
        <TextField name="customer.icDph" label={t.basics.icDph} />
        <TextField name="customer.web" label={t.basics.web} autoComplete="url" />
        <TextField name="customer.email" label={t.basics.email} type="email" />
        <TextField name="customer.phone" label={t.basics.phone} type="tel" />
      </div>
    </Section>
  );
}

function IndividualBasics() {
  const { control } = useFormContext<CustomerFormValues>();
  return (
    <Section title={t.basics.personTitle}>
      <div className="space-y-4">
        <PersonFields prefix="customer" withPosition={false} />
        <FormField
          control={control}
          name="customer.receivesBulk"
          render={({ field }) => (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border-subtle p-4">
              <div>
                <p className="text-sm font-medium">{sk.contacts.dialog.receivesBulk}</p>
                <p className="text-xs text-muted">{sk.contacts.dialog.receivesBulkHint}</p>
              </div>
              <Switch
                checked={field.value}
                label={sk.contacts.dialog.receivesBulk}
                onChange={() => field.onChange(!field.value)}
              />
            </div>
          )}
        />
      </div>
    </Section>
  );
}

/** The type, with „Nový typ organizácie“ adding one to the code list on the spot. */
function TypeField() {
  const { setValue, control } = useFormContext<CustomerFormValues>();
  const typeId = useWatch({ control, name: 'customer.typeId' });
  const toast = useToast();
  const queryClient = useQueryClient();
  const options = useQuery(trpc.customer.options.queryOptions());
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const create = useMutation(
    trpc.codeList.create.mutationOptions({
      onSuccess: async (created) => {
        await queryClient.invalidateQueries(trpc.customer.options.pathFilter());
        setValue('customer.typeId', created.id, { shouldDirty: true });
        setAdding(false);
        setName('');
      },
      onError: (error) => toast('error', errorMessage(error, sk.codeLists.errors)),
    }),
  );
  if (adding) {
    return (
      <div className="space-y-2">
        <label htmlFor="new-type" className="text-sm font-medium">
          {t.basics.newType}
        </label>
        <div className="flex gap-2">
          <Input
            id="new-type"
            autoFocus
            maxLength={80}
            placeholder={t.basics.newTypePlaceholder}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (name.trim()) create.mutate({ list: 'customer_type', name: name.trim() });
              }
              if (event.key === 'Escape') setAdding(false);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate({ list: 'customer_type', name: name.trim() })}
          >
            {t.basics.addType}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
            {sk.common.cancel}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <SelectField
      name="customer.typeId"
      label={t.basics.type}
      onPick={(value) => {
        if (value !== NEW_TYPE) return false;
        setAdding(true);
        return true;
      }}
    >
      <SelectItem value="">{t.basics.noType}</SelectItem>
      {offered(options.data?.types, typeId).map((type) => (
        <SelectItem key={type.id} value={type.id}>
          {type.name}
        </SelectItem>
      ))}
      <SelectItem value={NEW_TYPE}>+ {t.basics.newType}</SelectItem>
    </SelectField>
  );
}

function Classification() {
  const { control } = useFormContext<CustomerFormValues>();
  const options = useQuery(trpc.customer.options.queryOptions());
  const kind = useWatch({ control, name: 'customer.kind' });
  const sourceId = useWatch({ control, name: 'customer.sourceId' });
  const c = t.classification;
  return (
    <Section title={c.title} lead={c.lead}>
      <div className="grid gap-4 @md:grid-cols-3">
        <SelectField name="customer.status" label={c.status}>
          {CUSTOMER_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {sk.customers.status[s]}
            </SelectItem>
          ))}
        </SelectField>
        <SelectField name="customer.ownerUserId" label={c.owner}>
          <SelectItem value="">{c.noOwner}</SelectItem>
          {(options.data?.users ?? []).map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
            </SelectItem>
          ))}
        </SelectField>
        <SelectField name="customer.sourceId" label={c.source}>
          <SelectItem value="">{c.noSource}</SelectItem>
          {offered(options.data?.sources, sourceId).map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectField>
        {kind === 'individual' ? (
          <div className="@md:col-span-3">
            <TypeOfIndividual />
          </div>
        ) : null}
        <div className="@md:col-span-2">
          <TagsField suggestions={(options.data?.tags ?? []).map((tag) => tag.name)} />
        </div>
        <TextField name="customer.almaOrganizationId" label={c.almaId} />
        <FormField
          control={control}
          name="customer.note"
          render={({ field }) => (
            <FormItem className="@md:col-span-3">
              <FormLabel>{c.note}</FormLabel>
              <FormControl>
                <Textarea rows={3} maxLength={4000} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </Section>
  );
}

/** A private person may have a type too, though usually none. */
function TypeOfIndividual() {
  const options = useQuery(trpc.customer.options.queryOptions());
  const typeId = useWatch({
    control: useFormContext<CustomerFormValues>().control,
    name: 'customer.typeId',
  });
  return (
    <SelectField name="customer.typeId" label={t.basics.type}>
      <SelectItem value="">{t.basics.noType}</SelectItem>
      {offered(options.data?.types, typeId).map((type) => (
        <SelectItem key={type.id} value={type.id}>
          {type.name}
        </SelectItem>
      ))}
    </SelectField>
  );
}

/** The tags as chips and a field to type a new or existing one; Enter or a comma adds it. */
function TagsField({ suggestions }: { suggestions: string[] }) {
  const { control } = useFormContext<CustomerFormValues>();
  const c = t.classification;
  const [draft, setDraft] = useState('');
  return (
    <FormField
      control={control}
      name="customer.tags"
      render={({ field }) => {
        const tags = field.value;
        const add = (raw: string) => {
          const name = raw.trim().replace(/,$/, '').trim();
          if (
            name &&
            !tags.some((tag) => tag.toLocaleLowerCase('sk') === name.toLocaleLowerCase('sk'))
          )
            field.onChange([...tags, name]);
          setDraft('');
        };
        return (
          <FormItem>
            <FormLabel>{c.tags}</FormLabel>
            <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[10px] border border-border bg-white px-2 py-1.5 focus-within:border-primary">
              {tags.map((tag) => (
                <TagChip
                  key={tag}
                  removeLabel={c.removeTag(tag)}
                  onRemove={() => field.onChange(tags.filter((x) => x !== tag))}
                >
                  {tag}
                </TagChip>
              ))}
              <FormControl>
                <input
                  list="customer-tag-options"
                  maxLength={40}
                  value={draft}
                  placeholder={c.tagPlaceholder}
                  onChange={(event) => {
                    if (event.target.value.endsWith(',')) add(event.target.value);
                    else setDraft(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      add(draft);
                    }
                    if (event.key === 'Backspace' && !draft && tags.length > 0)
                      field.onChange(tags.slice(0, -1));
                  }}
                  onBlur={() => {
                    add(draft);
                    field.onBlur();
                  }}
                  className="min-w-32 flex-1 bg-transparent px-1 text-sm outline-none"
                />
              </FormControl>
              <datalist id="customer-tag-options">
                {suggestions
                  .filter((s) => !tags.includes(s))
                  .map((s) => (
                    <option key={s} value={s} />
                  ))}
              </datalist>
            </div>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

/** The signed-in user, the default owner of a new customer. */
export const useCurrentUserId = () => useSession((s) => s.user?.id ?? '');
