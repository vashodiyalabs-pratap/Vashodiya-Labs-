const header = document.getElementById('header');
const progress = document.getElementById('progress');
const menuToggle = document.getElementById('menuToggle');
const navLinks = document.getElementById('navLinks');
const chatToggle = document.getElementById('chatToggle');
const chatbotPanel = document.getElementById('chatbotPanel');
const chatbotClose = document.getElementById('chatbotClose');

window.addEventListener(
  'scroll',
  () => {
    header?.classList.toggle('scrolled', window.scrollY > 25);
    if (progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
    }
  },
  { passive: true },
);

if (menuToggle && navLinks) {
  const closeMenu = () => {
    navLinks.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation');
  };

  menuToggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });
}

const closeChat = (returnFocus = false) => {
  if (!chatbotPanel || !chatToggle) return;
  chatbotPanel.hidden = true;
  chatToggle.setAttribute('aria-expanded', 'false');
  if (returnFocus) chatToggle.focus();
};

if (chatToggle && chatbotPanel) {
  chatToggle.addEventListener('click', () => {
    const opening = chatbotPanel.hidden;
    chatbotPanel.hidden = !opening;
    chatToggle.setAttribute('aria-expanded', String(opening));

    if (opening) {
      navLinks?.classList.remove('open');
      menuToggle?.setAttribute('aria-expanded', 'false');
      chatbotPanel.querySelector('select')?.focus();
    }
  });

  chatbotClose?.addEventListener('click', () => closeChat(true));

  document.addEventListener('pointerdown', (event) => {
    if (
      !chatbotPanel.hidden &&
      !chatbotPanel.contains(event.target) &&
      !chatToggle.contains(event.target)
    ) {
      closeChat();
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;

  if (chatbotPanel && !chatbotPanel.hidden) {
    closeChat(true);
  } else if (menuToggle && navLinks) {
    navLinks.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation');
  }
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries, currentObserver) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          currentObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );

  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
} else {
  document.querySelectorAll('.reveal').forEach((element) => element.classList.add('visible'));
}

const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();

const referenceNumber = document.getElementById('referenceNumber');
const thankYouHeading = document.getElementById('thankYouHeading');
const thankYouMessage = document.getElementById('thankYouMessage');
const referenceId = new URLSearchParams(window.location.search).get('ref');

if (referenceNumber && thankYouHeading && thankYouMessage && referenceId) {
  thankYouHeading.textContent = 'Thanks for getting in touch.';
  thankYouMessage.textContent =
    'Your inquiry has been received. We’ll review the details and follow up about next steps.';
  referenceNumber.textContent = `Reference ID: ${referenceId}`;
  referenceNumber.hidden = false;
}

const siteConfig = window.VASHODIYA_CONFIG || {};
const whatsappDigits = String(siteConfig.whatsappNumber || '').replace(/\D/g, '');
if (whatsappDigits.length >= 8 && whatsappDigits.length <= 15) {
  document.querySelectorAll('[data-whatsapp-link]').forEach((link) => {
    link.href = `https://wa.me/${whatsappDigits}?text=${encodeURIComponent('Hi Vashodiya Labs, I would like to discuss a project.')}`;
    link.hidden = false;
  });
}

const publicEmail = String(siteConfig.contactEmail || '').trim();
if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicEmail)) {
  document.querySelectorAll('[data-email-link]').forEach((link) => {
    link.href = `mailto:${publicEmail}`;
    link.hidden = false;
  });
}

let bookingUrl;
try {
  const candidate = new URL(siteConfig.bookingUrl || '');
  if (candidate.protocol === 'https:' && !candidate.username && !candidate.password) {
    bookingUrl = candidate.href;
  }
} catch {
  bookingUrl = undefined;
}
if (bookingUrl) {
  document.querySelectorAll('[data-booking-link]').forEach((link) => {
    link.href = bookingUrl;
    link.hidden = false;
  });
} else {
  const sourcePage = window.location.pathname || '/';
  const callRequestUrl = new URL('/', window.location.origin);
  callRequestUrl.searchParams.set('request', 'call');
  callRequestUrl.searchParams.set('source', sourcePage);
  callRequestUrl.hash = 'contact';

  document.querySelectorAll('[data-booking-link]').forEach((link) => {
    link.href = `${callRequestUrl.pathname}${callRequestUrl.search}${callRequestUrl.hash}`;
    link.removeAttribute('target');
    link.removeAttribute('rel');
    link.textContent = 'Request a discovery call';
    link.hidden = false;
  });
}

const measurementId = String(siteConfig.ga4MeasurementId || '').trim();
const analyticsConsentKey = 'vashodiyaAnalyticsConsent';
let analyticsReady = false;

const trackLeadSubmission = (service, sourcePage = window.location.pathname) => {
  if (!analyticsReady || typeof window.gtag !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let timeout;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    timeout = window.setTimeout(finish, 800);
    try {
      window.gtag('event', 'generate_lead', {
        service: service || 'unspecified',
        source_page: sourcePage,
        transport_type: 'beacon',
        event_callback: finish,
        event_timeout: 750,
      });
    } catch (error) {
      console.error('Lead conversion could not be queued in Google Analytics:', error);
      finish();
    }
  });
};

const enableAnalytics = () => {
  if (analyticsReady || !/^G-[A-Z0-9]+$/.test(measurementId)) return;
  analyticsReady = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, { send_page_view: false });
  window.gtag('event', 'page_view', {
    page_title: document.title,
    page_path: window.location.pathname,
    page_location: `${siteConfig.siteUrl || window.location.origin}${window.location.pathname}`,
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  script.onerror = () => console.error('Google Analytics failed to load.');
  document.head.append(script);
};

if (/^G-[A-Z0-9]+$/.test(measurementId)) {
  let savedConsent;
  try {
    savedConsent = localStorage.getItem(analyticsConsentKey);
  } catch (error) {
    console.error('Analytics consent could not be read from browser storage:', error);
  }
  if (savedConsent === 'granted') {
    enableAnalytics();
  } else if (!savedConsent) {
    const prompt = document.createElement('aside');
    prompt.className = 'analytics-consent';
    prompt.setAttribute('aria-label', 'Analytics consent');
    const message = document.createElement('p');
    message.textContent =
      'May we use Google Analytics to understand website visits and improve the site? Analytics stays off unless you opt in. You can still browse or contact us either way. ';
    const privacyLink = document.createElement('a');
    privacyLink.href = '/privacy';
    privacyLink.textContent = 'Privacy';
    message.append(privacyLink);
    const actions = document.createElement('div');
    actions.className = 'analytics-consent-actions';
    const decline = document.createElement('button');
    decline.type = 'button';
    decline.textContent = 'No thanks';
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.dataset.accept = '';
    accept.textContent = 'Allow analytics';
    decline.addEventListener('click', () => {
      try {
        localStorage.setItem(analyticsConsentKey, 'denied');
      } catch (error) {
        console.error('Analytics consent could not be saved:', error);
      }
      prompt.remove();
    });
    accept.addEventListener('click', () => {
      try {
        localStorage.setItem(analyticsConsentKey, 'granted');
      } catch (error) {
        console.error('Analytics consent could not be saved:', error);
      }
      prompt.remove();
      enableAnalytics();
    });
    actions.append(decline, accept);
    prompt.append(message, actions);
    document.body.append(prompt);
  }
}

const submitInquiry = async (form, statusElement) => {
  const submitButton = form.querySelector("button[type='submit']");
  statusElement.textContent = 'Sending your inquiry…';
  statusElement.dataset.state = 'pending';
  if (submitButton) submitButton.disabled = true;

  const query = new URLSearchParams(window.location.search);
  const sourceFromQuery = query.get('source');
  const sourcePage =
    sourceFromQuery &&
    sourceFromQuery.startsWith('/') &&
    !sourceFromQuery.startsWith('//') &&
    !/[?#]/.test(sourceFromQuery)
      ? sourceFromQuery
      : window.location.pathname;
  const payload = {
    name: form.elements.name.value.trim(),
    email: form.elements.email.value.trim(),
    phone: form.elements.phone?.value.trim() || '',
    company: form.elements.company?.value.trim() || '',
    service: form.elements.service.value,
    budget: form.elements.budget?.value || '',
    timeline: form.elements.timeline?.value.trim() || '',
    message: form.elements.message.value.trim(),
    sourcePage,
    website: form.elements.website?.value || '',
  };

  try {
    const apiBaseUrl = (window.VASHODIYA_CONFIG?.apiBaseUrl || window.location.origin).replace(
      /\/+$/,
      '',
    );
    const response = await fetch(`${apiBaseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      statusElement.textContent =
        result.message ||
        "We couldn't submit your inquiry. Please check your details and try again.";
      statusElement.dataset.state = 'error';
      return;
    }

    const savedReferenceId = result.data?.referenceId;
    if (!savedReferenceId) {
      throw new Error('The inquiry response did not include a reference ID.');
    }

    await trackLeadSubmission(payload.service, sourcePage);
    window.location.assign(`/thank-you?ref=${encodeURIComponent(savedReferenceId)}`);
  } catch (error) {
    console.error('Inquiry submission failed:', error);
    statusElement.textContent = "We couldn't reach the inquiry service. Please try again later.";
    statusElement.dataset.state = 'error';
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
};

const contactForm = document.getElementById('contactForm');
const formStatus = document.getElementById('formStatus');
if (contactForm && formStatus) {
  const query = new URLSearchParams(window.location.search);
  const requestedService = query.get('service');
  const serviceSelect = contactForm.elements.service;
  if (
    requestedService &&
    [...serviceSelect.options].some((option) => option.value === requestedService)
  ) {
    serviceSelect.value = requestedService;
  }

  if (query.get('request') === 'call' && contactForm.elements.message) {
    contactForm.elements.message.value =
      'I would like to schedule a discovery call. Please contact me to arrange a time.';
  }

  contactForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitInquiry(contactForm, formStatus);
  });
}

const chatbotForm = document.getElementById('chatbotForm');
const chatbotStatus = document.getElementById('chatbotStatus');
const chatbotConversation = document.getElementById('chatbotConversation');
const chatbotInput = document.getElementById('chatbotInput');
const chatbotSend = document.getElementById('chatbotSend');
const chatQuickReplies = document.getElementById('chatQuickReplies');

if (
  chatbotForm &&
  chatbotStatus &&
  chatbotConversation &&
  chatbotInput &&
  chatbotSend &&
  chatQuickReplies
) {
  const conversation = { step: 'service', service: '', name: '', email: '', message: '' };
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const addMessage = (text, role = 'bot') => {
    const row = document.createElement('div');
    row.className = `chat-message ${role}`;

    if (role === 'bot') {
      const avatar = document.createElement('span');
      avatar.className = 'chat-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = 'VL';
      row.appendChild(avatar);
    }

    const bubble = document.createElement('p');
    bubble.className = 'chatbot-intro';
    bubble.textContent = text;
    row.appendChild(bubble);
    chatbotConversation.appendChild(row);
    chatbotConversation.scrollTop = chatbotConversation.scrollHeight;
  };

  const ask = (step, prompt, placeholder) => {
    conversation.step = step;
    addMessage(prompt);
    chatbotInput.placeholder = placeholder;
    chatbotInput.disabled = false;
    chatbotSend.disabled = false;
    chatbotInput.focus();
  };

  const submitConversation = async () => {
    chatbotInput.disabled = true;
    chatbotSend.disabled = true;
    chatQuickReplies.hidden = true;
    chatbotStatus.textContent = 'Sending your project details securely…';
    chatbotStatus.dataset.state = 'pending';

    try {
      const apiBaseUrl = (window.VASHODIYA_CONFIG?.apiBaseUrl || window.location.origin).replace(
        /\/+$/,
        '',
      );
      const query = new URLSearchParams(window.location.search);
      const requestedSource = query.get('source');
      const sourcePage =
        requestedSource &&
        requestedSource.startsWith('/') &&
        !requestedSource.startsWith('//') &&
        !/[?#]/.test(requestedSource)
          ? requestedSource
          : window.location.pathname;
      const response = await fetch(`${apiBaseUrl}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...conversation, sourcePage }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success) {
        chatbotStatus.textContent =
          result?.message ||
          `The inquiry service returned an error (${response.status}). Please try again later.`;
        chatbotStatus.dataset.state = 'error';
        chatbotInput.disabled = false;
        chatbotSend.disabled = false;
        return;
      }

      const savedReferenceId = result.data?.referenceId;
      if (!savedReferenceId)
        throw new Error('The inquiry response did not include a reference ID.');
      await trackLeadSubmission(conversation.service, sourcePage);
      chatbotStatus.textContent = '';
      delete chatbotStatus.dataset.state;
      addMessage(
        `Thanks, ${conversation.name}! Your project inquiry has been saved. Our team will follow up at ${conversation.email}. Your reference ID is ${savedReferenceId}.`,
      );
      conversation.step = 'complete';
      chatbotInput.placeholder = 'Inquiry received';
    } catch (error) {
      console.error('Chat inquiry submission failed:', error);
      chatbotStatus.textContent =
        "We couldn't connect to the inquiry backend. Please try again later or use the contact form.";
      chatbotStatus.dataset.state = 'error';
      chatbotInput.disabled = false;
      chatbotSend.disabled = false;
    }
  };

  chatQuickReplies.querySelectorAll('[data-service]').forEach((button) => {
    button.addEventListener('click', () => {
      if (conversation.step !== 'service') return;
      conversation.service = button.dataset.service;
      addMessage(button.textContent.trim(), 'user');
      chatQuickReplies.hidden = true;
      ask('name', 'Great choice. What name should we use when we reply?', 'Type your name…');
    });
  });

  chatbotForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = chatbotInput.value.trim();
    if (!value || conversation.step === 'complete' || conversation.step === 'service') return;
    chatbotInput.value = '';
    addMessage(value, 'user');

    if (conversation.step === 'name') {
      if (value.length < 2 || value.length > 150) {
        ask('name', 'Please enter a name between 2 and 150 characters.', 'Type your name…');
        return;
      }
      conversation.name = value;
      ask(
        'email',
        `Thanks, ${conversation.name}. What email address can we reach you at?`,
        'Your email address…',
      );
      return;
    }

    if (conversation.step === 'email') {
      if (value.length > 254 || !emailPattern.test(value)) {
        ask(
          'email',
          "That email doesn't look quite right. Please enter a valid email address.",
          'Your email address…',
        );
        return;
      }
      conversation.email = value;
      ask(
        'message',
        'What would you like us to build? A few sentences about your project will help us prepare.',
        'Describe your project…',
      );
      return;
    }

    if (conversation.step === 'message') {
      if (value.length < 10 || value.length > 2000) {
        ask(
          'message',
          'Please share at least 10 characters and no more than 2,000 so we understand what you need.',
          'Describe your project…',
        );
        return;
      }
      conversation.message = value;
      submitConversation();
    }
  });
}
