# Contributing to LeetFeedback

Thank you for your interest in contributing to LeetFeedback! This document provides guidelines and information for contributors to help maintain code quality and streamline the development process.

## Table of Contents

- [Development Roadmap](#development-roadmap)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Code Standards](#code-standards)
- [Making Changes](#making-changes)
- [Submitting Contributions](#submitting-contributions)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Documentation](#documentation)
- [Community Guidelines](#community-guidelines)

## Development Roadmap

LeetFeedback is actively developed across multiple phases, each introducing new capabilities and platform integrations. Understanding our roadmap helps contributors identify areas where they can make meaningful contributions.

### Phase 3: Study & Productivity Tools
**Enhanced learning tools and workspace integrations**

**Status**: In Development
**Key Features**:
- **ANKI flashcard auto-generation**: Automatically create flashcards from coding problems and concepts
- **Notion workspace integration**: Seamless sync with Notion for organized study notes
- **Study session planning**: Smart scheduling and planning tools for coding practice
- **Progress tracking dashboard**: Comprehensive view of learning progress and milestones

**Contribution Opportunities**:
- ANKI API integration
- Notion database schema design
- Study session algorithms
- Dashboard UI/UX improvements

### Phase 4: Analytics & Insights
**Comprehensive performance analytics and reporting**

**Status**: In Development
**Key Features**:
- **Advanced analytics dashboard**: Deep dive into coding performance metrics
- **Performance metrics visualization**: Interactive charts and graphs for progress tracking
- **Progress comparison tools**: Compare performance across different time periods and topics
- **Custom reporting features**: Generate personalized reports and insights

**Contribution Opportunities**:
- Data visualization components
- Statistical analysis algorithms
- Export functionality (PDF, CSV)
- Custom dashboard widgets

### Phase 5: Gamification & Engagement
**Achievement system and motivation features**

**Status**: In Development
**Key Features**:
- **Achievement badges & streaks**: Reward system for consistent practice and milestones
- **Leaderboards & competitions**: Community-driven competitive features
- **Goal setting & tracking**: Personal and team goal management
- **Motivation system**: Intelligent encouragement and progress celebration

**Contribution Opportunities**:
- Achievement system design
- Leaderboard algorithms
- Goal tracking mechanisms
- Motivation notification systems

### Phase 6: Platform Expansion (Public Release)
**Extended platform support and mobile experience**

**Status**: In Development
**Key Features**:
- **TUF+, CodeChef, HackerRank support**: Expand to additional coding platforms
- **Codeforces integration**: Contest tracking and analysis
- **Mobile companion app**: Cross-platform mobile application
- **Cross-platform synchronization**: Seamless data sync across devices

**Contribution Opportunities**:
- New platform content scripts
- Mobile app development (React Native/Flutter)
- Synchronization protocols
- Cross-platform testing

### Phase 7: Enterprise & Teams
**Team collaboration and organizational features**

**Status**: In Development
**Key Features**:
- **Team analytics dashboards**: Collaborative performance tracking
- **Organization management**: Multi-tier organizational structure support
- **Bootcamp integration tools**: Specialized tools for coding bootcamps and educational institutions
- **Advanced admin controls**: Comprehensive administrative features

**Contribution Opportunities**:
- Team collaboration features
- Administrative interfaces
- Educational institution integrations
- Multi-tenant architecture

### Phase 8: Security & Compliance
**Advanced security features and data protection**

**Status**: In Development
**Key Features**:
- **End-to-end encryption**: Secure data transmission and storage
- **GDPR compliance**: Full compliance with data protection regulations
- **Data anonymization**: Privacy-focused data handling
- **Advanced privacy controls**: Granular user privacy settings

**Contribution Opportunities**:
- Security auditing
- Encryption implementation
- Privacy policy compliance
- Data anonymization algorithms

### How to Contribute to Roadmap Items

1. **Check Current Phase**: Focus contributions on current development phases (3-4)
2. **Review Issues**: Look for issues tagged with phase labels
3. **Propose Features**: Create detailed proposals for roadmap features
4. **Join Discussions**: Participate in feature planning discussions
5. **Prototype**: Build proof-of-concepts for complex features

### Issue Labels and Project Management

To help contributors navigate the roadmap effectively, we use a structured labeling system:

#### Phase Labels
- `phase-3-study-tools`: Study & Productivity Tools features
- `phase-4-analytics`: Analytics & Insights features  
- `phase-5-gamification`: Gamification & Engagement features
- `phase-6-platform-expansion`: Platform Expansion features
- `phase-7-enterprise`: Enterprise & Teams features
- `phase-8-security`: Security & Compliance features

#### Feature Type Labels
- `feature-anki`: ANKI flashcard integration
- `feature-notion`: Notion workspace integration
- `feature-dashboard`: Analytics dashboard components
- `feature-visualization`: Data visualization features
- `feature-achievements`: Achievement and badge system
- `feature-leaderboards`: Competition and ranking features
- `feature-mobile`: Mobile app development
- `feature-platform`: New platform integrations

#### Priority Labels
- `priority-high`: Critical features for current phase
- `priority-medium`: Important but not blocking
- `priority-low`: Nice-to-have features
- `good-first-issue`: Beginner-friendly contributions

#### Technical Labels
- `tech-frontend`: UI/UX development
- `tech-backend`: Server-side or extension background scripts
- `tech-api`: API integration work
- `tech-database`: Data storage and management
- `tech-mobile`: Mobile development (React Native/Flutter)

### Contributing to Specific Phases

**For Phase 3 Contributors (Study Tools)**:
1. Look for issues labeled `phase-3-study-tools`
2. Focus on `feature-anki` or `feature-notion` labels
3. Check the `study-tools/` directory structure
4. Test integrations with external APIs

**For Phase 4 Contributors (Analytics)**:
1. Search for `phase-4-analytics` labeled issues
2. Work on `feature-dashboard` and `feature-visualization` 
3. Build components in the `analytics/` directory
4. Focus on data visualization and reporting

**For Phase 5+ Contributors (Future Phases)**:
1. Look for respective phase labels
2. Create proof-of-concept implementations
3. Focus on architecture and design patterns
4. Document technical specifications

## Getting Started

### Prerequisites

- Node.js (version 16 or higher)
- Git
- Chrome browser for testing
- Basic knowledge of JavaScript, HTML, and CSS
- Familiarity with Chrome Extension APIs

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/leetFeedback.git
   cd leetFeedback
   ```
3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/QuickHasaCat/leetFeedback.git
   ```

## Development Setup

1. **Install Dependencies** (if applicable):
   ```bash
   npm install
   ```

2. **Load Extension in Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in the top right)
   - Click "Load unpacked" and select the `leetFeedback-extension` directory
   - The extension should now appear in your extensions list

3. **Enable Developer Tools**:
   - Right-click the extension icon and select "Inspect popup" for popup debugging
   - Use Chrome DevTools for content script debugging on supported websites

## Code Standards

### JavaScript Style Guide

- Use modern ES6+ syntax
- Follow consistent indentation (2 spaces)
- Use meaningful variable and function names
- Add comments for complex logic
- Avoid global variables when possible

### File Organization

- Place utility functions in the `utils/` directory
- Content scripts go in `content-scripts/` directory
- UI components belong in the `popup/` directory
- Keep related functionality together

### Commit Messages

Use conventional commit format:
```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
- `feat(leetcode): add solution tracking for premium problems`
- `fix(popup): resolve GitHub authentication flow`
- `docs(readme): update installation instructions`

## Making Changes

### Before You Start

1. Check existing issues and pull requests to avoid duplicates
2. Create an issue for major changes to discuss the approach
3. Keep changes focused and atomic

### Development Workflow

1. **Create a Branch**:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

2. **Make Your Changes**:
   - Follow the code standards
   - Test your changes thoroughly
   - Update documentation if needed

3. **Test Your Changes**:
   - Load the extension in Chrome
   - Test on supported platforms (LeetCode, GeeksforGeeks, etc.)
   - Verify no console errors
   - Check that existing functionality still works

4. **Commit Your Changes**:
   ```bash
   git add .
   git commit -m "feat(scope): your descriptive commit message"
   ```

## Submitting Contributions

### Pull Request Process

1. **Update Your Branch**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push to Your Fork**:
   ```bash
   git push origin your-branch-name
   ```

3. **Create Pull Request**:
   - Go to the GitHub repository
   - Click "New Pull Request"
   - Select your branch
   - Fill out the PR template

### Pull Request Guidelines

- **Title**: Clear, descriptive title
- **Description**: Explain what changes you made and why
- **Testing**: Describe how you tested your changes
- **Screenshots**: Include screenshots for UI changes
- **Issues**: Reference any related issues using `Fixes #123`

### PR Template

```markdown
## Description
Brief description of changes made.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Code refactoring

## Testing
- [ ] Tested on LeetCode
- [ ] Tested on GeeksforGeeks
- [ ] Tested popup functionality
- [ ] No console errors

## Screenshots (if applicable)
Add screenshots here.

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes
```

## Project Structure

### Current Structure
```
leetFeedback-extension/
├── content-scripts/          # Platform-specific content scripts
│   ├── leetcode.js          # LeetCode integration
│   ├── geeksforgeeks.js     # GeeksforGeeks integration
│   ├── takeuforward.js      # TUF integration
│   └── website-auth.js      # Authentication handling
├── utils/                   # Shared utility functions
│   ├── common.js           # Common utilities
│   ├── github-api.js       # GitHub API integration
│   ├── gemini-api.js       # AI analysis utilities
│   ├── time-tracker.js     # Time tracking functionality
│   └── interceptor.js      # Request interception
├── popup/                   # Extension popup UI
│   ├── popup.html          # Popup interface
│   ├── popup.js            # Popup logic
│   └── popup.css           # Popup styling
├── icons/                   # Extension icons
├── background.js            # Background service worker
├── manifest.json           # Extension manifest
└── README.md               # Project documentation
```

### Planned Structure (Roadmap Features)
```
leetFeedback-extension/
├── content-scripts/          # Current platform integrations
├── utils/                   # Current shared utilities
├── popup/                   # Current popup UI
├── analytics/               # Phase 4: Analytics & Insights
│   ├── dashboard/          # Advanced analytics dashboard
│   ├── visualizations/     # Performance metrics charts
│   ├── reports/            # Custom reporting features
│   └── comparisons/        # Progress comparison tools
├── study-tools/             # Phase 3: Study & Productivity
│   ├── anki/              # ANKI flashcard integration
│   ├── notion/            # Notion workspace integration
│   ├── planner/           # Study session planning
│   └── progress/          # Progress tracking dashboard
├── gamification/            # Phase 5: Gamification & Engagement
│   ├── achievements/      # Badge and streak system
│   ├── leaderboards/      # Competition features
│   ├── goals/             # Goal setting & tracking
│   └── motivation/        # Motivation system
├── platforms/               # Phase 6: Platform Expansion
│   ├── codeforces/        # Codeforces integration
│   ├── codechef/          # CodeChef support
│   ├── hackerrank/        # HackerRank support
│   └── mobile-sync/       # Cross-platform synchronization
├── enterprise/              # Phase 7: Enterprise & Teams
│   ├── teams/             # Team collaboration
│   ├── organizations/     # Organization management
│   ├── bootcamps/         # Bootcamp integration
│   └── admin/             # Advanced admin controls
├── security/                # Phase 8: Security & Compliance
│   ├── encryption/        # End-to-end encryption
│   ├── privacy/           # Privacy controls
│   ├── compliance/        # GDPR compliance
│   └── anonymization/     # Data anonymization
└── shared/                  # Cross-phase shared components
    ├── components/        # Reusable UI components
    ├── services/          # Shared services
    └── types/             # TypeScript definitions
```

### Directory Guidelines by Phase

**Phase 3 Contributors**: Focus on `study-tools/` directory
- Implement ANKI integration in `study-tools/anki/`
- Build Notion connectors in `study-tools/notion/`
- Create planning algorithms in `study-tools/planner/`

**Phase 4 Contributors**: Work within `analytics/` directory
- Develop dashboard components in `analytics/dashboard/`
- Create visualization libraries in `analytics/visualizations/`
- Build reporting engines in `analytics/reports/`

**Phase 5 Contributors**: Develop `gamification/` features
- Design achievement systems in `gamification/achievements/`
- Implement leaderboards in `gamification/leaderboards/`
- Create goal tracking in `gamification/goals/`

**Future Phases**: Plan for `platforms/`, `enterprise/`, and `security/` directories

## Testing

### Manual Testing Checklist

#### Core Extension Testing
- [ ] Extension loads without errors
- [ ] Popup interface functions correctly
- [ ] Content scripts inject properly on target sites
- [ ] GitHub integration works
- [ ] AI analysis features function
- [ ] Time tracking operates correctly
- [ ] No console errors in any component

#### Phase-Specific Testing

**Phase 3: Study & Productivity Tools**
- [ ] ANKI flashcard generation works correctly
- [ ] Notion integration syncs properly
- [ ] Study session planning saves and loads
- [ ] Progress tracking dashboard displays accurate data
- [ ] Integration APIs handle errors gracefully

**Phase 4: Analytics & Insights**
- [ ] Advanced analytics dashboard loads performance data
- [ ] Performance metrics visualize correctly
- [ ] Progress comparison tools show accurate comparisons
- [ ] Custom reports generate and export properly
- [ ] Dashboard widgets respond to user interactions

**Phase 5: Gamification & Engagement**
- [ ] Achievement badges display and unlock correctly
- [ ] Leaderboards show accurate rankings
- [ ] Goal setting and tracking functions properly
- [ ] Motivation notifications trigger appropriately
- [ ] Streak tracking maintains accuracy

### Platform-Specific Testing

**LeetCode**:
- [ ] Problem detection works
- [ ] Solution submission tracking
- [ ] Premium problem handling
- [ ] Contest participation tracking
- [ ] Discussion post integration

**GeeksforGeeks**:
- [ ] Practice problem tracking
- [ ] Article integration
- [ ] Solution analysis
- [ ] Course progress tracking

**TUF+ (In Development)**:
- [ ] Problem set integration
- [ ] Progress synchronization
- [ ] Advanced analytics features

**Future Platforms (Planned)**:
- [ ] CodeChef contest tracking
- [ ] HackerRank skill assessments
- [ ] Codeforces competition analysis

### Cross-Browser Testing

While Chrome is the primary target, test compatibility with:
- Chrome (primary)
- Chromium-based browsers (Edge, Brave)

### Integration Testing

**API Integrations**:
- [ ] GitHub API authentication and repository operations
- [ ] Gemini AI API for code analysis
- [ ] ANKI Connect API (Phase 3)
- [ ] Notion API (Phase 3)
- [ ] Platform APIs (LeetCode, GeeksforGeeks, etc.)

**Data Flow Testing**:
- [ ] Extension storage persistence
- [ ] Cross-tab communication
- [ ] Background script data processing
- [ ] Content script to popup communication

## Documentation

### Code Documentation

- Add JSDoc comments for functions
- Include parameter types and return values
- Provide usage examples for complex functions

Example:
```javascript
/**
 * Extracts problem information from LeetCode page
 * @param {Document} document - The page document
 * @returns {Object} Problem details including title, difficulty, and description
 */
function extractProblemInfo(document) {
  // Implementation
}
```

### README Updates

Update README.md when:
- Adding new features
- Changing installation process
- Modifying supported platforms
- Adding new configuration options

## Community Guidelines

### Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Help newcomers learn
- Focus on the technical aspects

### Getting Help

- **Issues**: Create GitHub issues for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions
- **Email**: Contact the maintainers at catince@outlook.com

### Recognition

Contributors will be:
- Listed in the project's contributors section
- Acknowledged in release notes
- Invited to join the core team for significant contributions

## Common Issues and Solutions

### Extension Not Loading
- Check manifest.json syntax
- Verify all file paths exist
- Look for JavaScript errors in console

### Content Script Not Working
- Ensure correct URL patterns in manifest
- Check if the target website changed structure
- Verify injection timing

### API Integration Issues
- Check API key configuration
- Verify network permissions
- Test with minimal requests first

## Release Process

1. Version bumping follows semantic versioning
2. Changes are documented in release notes
3. Testing is performed across all supported platforms
4. Extensions are submitted to Chrome Web Store

Thank you for contributing to LeetFeedback! Your efforts help make coding practice more intelligent and accessible for everyone.
