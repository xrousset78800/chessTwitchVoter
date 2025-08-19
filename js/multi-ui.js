// js/multi-ui.js - Gestion des interactions UI et animations

class UIManager {
    constructor() {
        this.animations = {
            cardHover: true,
            transitions: true,
            parallax: true
        };
        
        this.init();
    }
    
    init() {
        this.setupAnimations();
        this.setupTooltips();
        this.setupKeyboardShortcuts();
        this.setupFormValidation();
        this.checkUserPreferences();
    }
    
    setupAnimations() {
        // Card hover effects
        document.querySelectorAll('.mode-card, .role-card').forEach(card => {
            card.addEventListener('mouseenter', (e) => {
                if (this.animations.cardHover && !card.classList.contains('disabled')) {
                    this.createRipple(e, card);
                }
            });
        });
        
        // Button click effects
        document.querySelectorAll('.btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.createButtonRipple(e);
            });
        });
        
        // Smooth scroll for navigation
        this.enableSmoothScroll();
        
        // Parallax effect on header
        if (this.animations.parallax) {
            this.setupParallax();
        }
    }
    
    createRipple(e, element) {
        const ripple = document.createElement('div');
        ripple.className = 'ripple';
        
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;
        
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        
        element.appendChild(ripple);
        
        setTimeout(() => ripple.remove(), 600);
    }
    
    createButtonRipple(e) {
        const btn = e.currentTarget;
        const ripple = document.createElement('span');
        ripple.className = 'btn-ripple';
        
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;
        
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        
        btn.appendChild(ripple);
        
        setTimeout(() => ripple.remove(), 600);
    }
    
    setupParallax() {
        const header = document.querySelector('.main-header');
        if (!header) return;
        
        let ticking = false;
        
        const updateParallax = () => {
            const scrolled = window.pageYOffset;
            const speed = 0.5;
            
            header.style.transform = `translateY(${scrolled * speed}px)`;
            ticking = false;
        };
        
        window.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(updateParallax);
                ticking = true;
            }
        });
    }
    
    enableSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });
    }
    
    setupTooltips() {
        // Add tooltips to info icons
        document.querySelectorAll('[data-tooltip]').forEach(element => {
            element.addEventListener('mouseenter', (e) => {
                this.showTooltip(e.target, e.target.dataset.tooltip);
            });
            
            element.addEventListener('mouseleave', () => {
                this.hideTooltip();
            });
        });
    }
    
    showTooltip(element, text) {
        const tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.textContent = text;
        
        document.body.appendChild(tooltip);
        
        const rect = element.getBoundingClientRect();
        tooltip.style.left = rect.left + rect.width / 2 - tooltip.offsetWidth / 2 + 'px';
        tooltip.style.top = rect.top - tooltip.offsetHeight - 10 + 'px';
        
        setTimeout(() => {
            tooltip.classList.add('visible');
        }, 10);
    }
    
    hideTooltip() {
        const tooltip = document.querySelector('.tooltip');
        if (tooltip) {
            tooltip.classList.remove('visible');
            setTimeout(() => tooltip.remove(), 300);
        }
    }
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + Enter to launch game
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                const launchBtn = document.getElementById('launchBtn');
                if (launchBtn && launchBtn.style.display !== 'none') {
                    launchBtn.click();
                }
            }
            
            // Arrow keys for navigation
            if (e.key === 'ArrowRight') {
                const nextBtn = document.getElementById('nextBtn');
                if (nextBtn && nextBtn.style.display !== 'none') {
                    nextBtn.click();
                }
            }
            
            if (e.key === 'ArrowLeft') {
                const prevBtn = document.getElementById('prevBtn');
                if (prevBtn && prevBtn.style.display !== 'none') {
                    prevBtn.click();
                }
            }
            
            // Number keys for quick mode selection
            if (e.key >= '1' && e.key <= '6' && !e.ctrlKey && !e.altKey) {
                const modeCards = document.querySelectorAll('.mode-card:not(.disabled)');
                const index = parseInt(e.key) - 1;
                if (modeCards[index]) {
                    modeCards[index].click();
                }
            }
        });
    }
    
    setupFormValidation() {
        // Real-time validation for text inputs
        document.querySelectorAll('.form-control').forEach(input => {
            input.addEventListener('blur', () => {
                this.validateInput(input);
            });
            
            input.addEventListener('input', () => {
                if (input.classList.contains('error')) {
                    this.validateInput(input);
                }
            });
        });
        
        // Special validation for game code input
        const gameCodeInput = document.getElementById('gameCodeInput');
        if (gameCodeInput) {
            gameCodeInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            });
        }
        
        // Number input constraints
        document.querySelectorAll('input[type="number"]').forEach(input => {
            input.addEventListener('input', () => {
                const min = parseInt(input.min);
                const max = parseInt(input.max);
                const value = parseInt(input.value);
                
                if (value < min) input.value = min;
                if (value > max) input.value = max;
            });
        });
    }
    
    validateInput(input) {
        const value = input.value.trim();
        
        // Remove previous error state
        input.classList.remove('error', 'success');
        
        // Check if required
        if (input.hasAttribute('required') && !value) {
            input.classList.add('error');
            this.showInputError(input, 'Ce champ est requis');
            return false;
        }
        
        // Check pattern if exists
        if (input.pattern) {
            const pattern = new RegExp(input.pattern);
            if (!pattern.test(value)) {
                input.classList.add('error');
                this.showInputError(input, 'Format invalide');
                return false;
            }
        }
        
        // Check min/max length
        if (input.minLength && value.length < input.minLength) {
            input.classList.add('error');
            this.showInputError(input, `Minimum ${input.minLength} caractères`);
            return false;
        }
        
        if (input.maxLength && value.length > input.maxLength) {
            input.classList.add('error');
            this.showInputError(input, `Maximum ${input.maxLength} caractères`);
            return false;
        }
        
        // If all validations pass
        if (value) {
            input.classList.add('success');
        }
        this.hideInputError(input);
        return true;
    }
    
    showInputError(input, message) {
        let errorElement = input.parentElement.querySelector('.form-error');
        
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.className = 'form-error';
            input.parentElement.appendChild(errorElement);
        }
        
        errorElement.textContent = message;
    }
    
    hideInputError(input) {
        const errorElement = input.parentElement.querySelector('.form-error');
        if (errorElement) {
            errorElement.remove();
        }
    }
    
    checkUserPreferences() {
        // Check for reduced motion preference
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.animations.cardHover = false;
            this.animations.transitions = false;
            this.animations.parallax = false;
            document.body.classList.add('reduced-motion');
        }
        
        // Check for dark mode preference (already using dark theme by default)
        if (window.matchMedia('(prefers-color-scheme: light)').matches) {
            // Could add light theme support here
        }
        
        // Check for high contrast preference
        if (window.matchMedia('(prefers-contrast: high)').matches) {
            document.body.classList.add('high-contrast');
        }
    }
    
    // Loading states
    setButtonLoading(button, loading = true) {
        if (loading) {
            button.disabled = true;
            button.classList.add('loading');
            button.dataset.originalText = button.textContent;
            button.textContent = '';
        } else {
            button.disabled = false;
            button.classList.remove('loading');
            if (button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
                delete button.dataset.originalText;
            }
        }
    }
    
    // Progress indicator for multi-step form
    updateProgress(step, totalSteps) {
        const progress = (step / totalSteps) * 100;
        
        let progressBar = document.querySelector('.progress-bar');
        if (!progressBar) {
            progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            progressBar.innerHTML = '<div class="progress-fill"></div>';
            document.querySelector('.container').insertBefore(
                progressBar,
                document.querySelector('.container').firstChild
            );
        }
        
        const fill = progressBar.querySelector('.progress-fill');
        fill.style.width = `${progress}%`;
    }
    
    // Theme switcher (for future light mode)
    toggleTheme() {
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
    }
    
    // Initialize theme from storage
    initTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light') {
            document.body.classList.add('light-theme');
        }
    }
}

// Initialize UI Manager
document.addEventListener('DOMContentLoaded', () => {
    window.uiManager = new UIManager();
});