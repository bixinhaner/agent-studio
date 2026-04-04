describe('Admin Console Smoke Tests', () => {
  beforeEach(() => {
    cy.visit('/#admin/overview');
  });

  it('loads the admin overview dashboard', () => {
    cy.contains('平台概览').should('be.visible');
    cy.contains('用户规模').should('be.visible');
    cy.contains('活跃会话').should('be.visible');
  });

  it('navigates to users view and searches', () => {
    // Click on Users section in the sidebar
    cy.get('.admin-menu-item').contains('用户治理').click();
    cy.hash().should('include', 'users');
    
    // Ensure Users page loads
    cy.contains('共').should('be.visible');
    
    // Test the search functionality
    cy.get('input[placeholder*="搜索姓名"]').type('test user');
  });

  it('opens command palette with Cmd+K', () => {
    // Trigger command palette
    cy.get('body').type('{cmd}k');
    
    // Search in command palette
    cy.get('input[placeholder*="Search features"]').type('集成');
    cy.contains('集成中心').click();
    
    cy.hash().should('include', 'integrations');
  });
});
